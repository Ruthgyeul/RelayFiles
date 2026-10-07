import "server-only";
import { verify } from "@node-rs/argon2";
import { getAppEnv } from "@/config/env";
import { MS, SHARE } from "@/config/policy";
import type { ShareCrumb, ShareItem, SharePage, ShareView } from "@/contracts/share";
import { limitHit, shareStatus, busyBadge, type Busy, type ShareStatus } from "@/domain/share";
import { effectiveVisibility, settingTags, sortNodes, type NodeKind, type SettingTag, type Visibility } from "@/domain/tree";
import type { ClientInfo } from "../auth/client-info";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { ancestorChain, type NodeRow } from "../repositories/node.repo";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import { findByLinkId, publicTree, type SharedRow } from "../repositories/share.repo";
import { redis } from "../redis";
import { busyLevels } from "../share/busy";
import { addUnlock, type Unlocks } from "../share/unlock-cookie";

/** Who is looking at a share link. */
export interface ShareViewer {
  /** Accounts signed in on this device (the owner sees the visitor preview bar). */
  accountIds: readonly string[];
  unlocks: Unlocks;
}

const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;
const kindOf = (row: { kind: string | null }) => (row.kind ? (lower(row.kind) as NodeKind) : null);

export const shareUrl = (linkId: string) => `${getAppEnv().PUBLIC_URL}/d/${linkId}`;

/** A link's settings, owner and status. Null when no item has this link. */
export async function loadLink(linkId: string, viewer: ShareViewer, now: number) {
  const root = await findByLinkId(db(), linkId);
  if (!root) return null;
  const chain = await ancestorChain(db(), root.id);
  const visibility = effectiveVisibility(chain.map((row) => lower(row.visibility) as Visibility).reverse());
  const status: ShareStatus = shareStatus(
    {
      expAt: root.expAt?.getTime() ?? null,
      burn: root.burn,
      downloads: root.downloads,
      downloadLimit: root.downloadLimit,
      effectiveVisibility: visibility,
      hasPassword: root.passwordHash !== null,
      unlocked: viewer.unlocks.has(linkId),
    },
    now,
  );
  return { root, chain, status, isOwner: viewer.accountIds.includes(root.accountId) };
}

export type LoadedLink = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

/** Tags under the share page title: settings without "Public" and the lock (design `sh.tags`). */
function shareTags(root: NodeRow, now: number): SettingTag[] {
  const tags = settingTags(
    {
      visibility: lower(root.visibility) as Visibility,
      expiry: root.expiryLabel,
      expAt: root.expAt?.getTime() ?? null,
      burn: root.burn,
      downloadLimit: root.downloadLimit,
      hasPassword: root.passwordHash !== null,
      access: root.access === "STREAM" ? "stream" : "both",
    },
    root.downloads,
    null,
    now,
  ).filter((tag) => tag.icon !== "lock-simple" && tag.label !== "Public");
  if (root.access === "STREAM") tags.push({ icon: "prohibit", label: "Downloads disabled" });
  return tags;
}

/** Index of a visible tree: children per folder and total file bytes below each node. */
function indexTree(rows: readonly SharedRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, SharedRow[]>();
  for (const row of rows) {
    if (!row.parentId || !byId.has(row.parentId)) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }
  const sizes = new Map<string, bigint>();
  const sizeOf = (row: SharedRow): bigint => {
    const known = sizes.get(row.id);
    if (known !== undefined) return known;
    const size = row.type === "FILE" ? row.size : (children.get(row.id) ?? []).reduce((sum, child) => sum + sizeOf(child), 0n);
    sizes.set(row.id, size);
    return size;
  };
  return { byId, children, sizeOf };
}

/** Whether visitors may download this row (design `canDl`). */
function canDownload(row: SharedRow, root: NodeRow, busy: Busy | undefined): boolean {
  return root.access !== "STREAM" && row.access !== "STREAM" && !limitHit(row.downloadLimit, row.downloads) && (busy?.level ?? 0) < 2;
}

/** The open share page for a folder inside the link (or the shared file). Null if not inside. */
async function buildView(link: LoadedLink, folderId: string | null, now: number): Promise<ShareView | null> {
  const { root } = link;
  const tree = await publicTree(db(), root.id);
  const { byId, children, sizeOf } = indexTree(tree);
  const rootRow = byId.get(root.id)!;
  const fileLink = root.type === "FILE";
  const folder = fileLink ? rootRow : byId.get(folderId ?? root.id);
  if (!folder || (!fileLink && folder.type !== "FOLDER")) return null;

  const crumbs: ShareCrumb[] = [];
  for (let at: SharedRow | undefined = folder; at; at = at.id === root.id ? undefined : byId.get(at.parentId ?? "")) crumbs.unshift({ id: at.id, name: at.name });

  const listed = fileLink ? [rootRow] : (children.get(folder.id) ?? []);
  const sorted = sortNodes(
    listed.map((row) => ({ row, type: lower(row.type) as "file" | "folder", name: row.name, kind: kindOf(row), size: Number(sizeOf(row)), createdAt: row.createdAt.getTime() })),
    "name",
  ).map((entry) => entry.row);
  const busy = await busyLevels(
    [folder, ...sorted].map((row) => ({ id: row.id, dlPaused: row.dlPaused || root.dlPaused })),
    now,
  );

  const items: ShareItem[] = sorted.map((row) => ({
    id: row.id,
    type: lower(row.type) as "file" | "folder",
    name: row.name,
    kind: kindOf(row),
    size: sizeOf(row).toString(),
    itemCount: (children.get(row.id) ?? []).length,
    busy: busyBadge(busy.get(row.id)!, now, "share"),
    canDownload: canDownload(row, root, busy.get(row.id)),
    hasThumb: row.type === "FILE" && row.hasThumb,
  }));
  return {
    root: { id: root.id, type: fileLink ? "file" : "folder", kind: kindOf(root), createdAt: root.createdAt.toISOString() },
    folder: { id: folder.id, name: folder.name, parentId: folder.id === root.id ? null : folder.parentId },
    crumbs,
    count: items.length,
    size: (fileLink ? rootRow.size : sizeOf(folder)).toString(),
    tags: shareTags(root, now),
    note: folder.id === root.id && root.note ? root.note : null,
    downloadsAllowed: root.access !== "STREAM",
    folderBusy: busyBadge(busy.get(folder.id)!, now, "share"),
    items,
  };
}

/** Where "Back to app" goes: the shared folder, or the folder holding a shared file. */
function ownerLinks({ root, chain }: LoadedLink): NonNullable<SharePage["owner"]> {
  const folderId = root.type === "FOLDER" ? root.id : chain.at(-2)!.id;
  return { nodeId: root.id, folderId, isRootFolder: folderId === chain[0]!.id };
}

/** Everything the share page needs. Null when the link (or the folder in it) does not exist. */
export async function sharePage(linkId: string, folderId: string | null, viewer: ShareViewer, now: number): Promise<{ page: SharePage; link: LoadedLink } | null> {
  const link = await loadLink(linkId, viewer, now);
  if (!link) return null;
  const { root, status, isOwner } = link;
  const view = status === "open" ? await buildView(link, folderId, now) : null;
  if (status === "open" && !view) return null;
  const page: SharePage = {
    linkId,
    url: shareUrl(linkId),
    status,
    name: root.name,
    owner: isOwner ? ownerLinks(link) : null,
    view,
  };
  return { page, link };
}

/**
 * The page for a link that no longer exists because its items expired and were deleted
 * (design "This link has expired"); null for links that never existed or were replaced.
 */
export async function retiredSharePage(linkId: string): Promise<SharePage | null> {
  if (!(await isRetiredLink(db(), linkId))) return null;
  return { linkId, url: shareUrl(linkId), status: "expired", name: "", owner: null, view: null };
}

/** A request for a link that does not exist: 410 when its items expired, otherwise 404. */
async function missingLinkError(linkId: string): Promise<ApiError> {
  return (await isRetiredLink(db(), linkId)) ? statusError("expired") : new ApiError("NOT_FOUND");
}

/** Error a file request gets when the page would show a card instead of the files. */
function statusError(status: Exclude<ShareStatus, "open">): ApiError {
  switch (status) {
    case "expired":
      return new ApiError("GONE", "This link has expired.");
    case "blocked":
      return new ApiError("FORBIDDEN", "Download limit reached");
    case "private":
      return new ApiError("NOT_FOUND");
    case "locked":
      return new ApiError("UNAUTHORIZED", "This link is password protected.");
  }
}

/** 429 with Retry-After while a file's downloads are paused (design "Server busy"). */
function busyError(busy: Busy, now: number): ApiError {
  if (busy.manual) return new ApiError("RATE_LIMITED", "Server busy · downloads for this file are paused");
  const retryAfter = busy.until ? Math.max(1, Math.ceil((busy.until - now) / MS.second)) : undefined;
  return new ApiError("RATE_LIMITED", "Server busy · try again later", { retryAfter });
}

export interface SharedFile {
  link: LoadedLink;
  row: SharedRow;
  /** Ids from the shared item down to the file (for busy tracking). */
  path: string[];
  /** Folder names from the account root down to the file. */
  segments: string[];
  busy: Busy;
}

/**
 * Checks that a visitor may play or download a file through a link: the link is open, the
 * file is inside it and visible, and (for downloads) downloads are allowed and not paused.
 */
export async function resolveSharedFile(linkId: string, nodeId: string, viewer: ShareViewer, purpose: "stream" | "download", now: number): Promise<SharedFile> {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  if (link.status !== "open") throw statusError(link.status);
  const tree = await publicTree(db(), link.root.id);
  const { byId } = indexTree(tree);
  const row = byId.get(nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");

  const path: string[] = [];
  for (let at: SharedRow | undefined = row; at; at = at.id === link.root.id ? undefined : byId.get(at.parentId ?? "")) path.unshift(at.id);
  const busy = (await busyLevels([{ id: row.id, dlPaused: row.dlPaused || link.root.dlPaused }], now)).get(row.id)!;
  if (purpose === "download") {
    if (link.root.access === "STREAM" || row.access === "STREAM") throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
    if (limitHit(row.downloadLimit, row.downloads)) throw new ApiError("FORBIDDEN", "Download limit reached");
    if (busy.level === 2) throw busyError(busy, now);
  }
  const chain = await ancestorChain(db(), row.id);
  return { link, row, path, segments: chain.slice(1).map((ancestor) => ancestor.name), busy };
}

/** Visible items of a link for "Download all" (zip), with the same checks as single downloads. */
export async function resolveSharedTree(linkId: string, folderId: string, viewer: ShareViewer, now: number) {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  if (link.status !== "open") throw statusError(link.status);
  if (link.root.access === "STREAM") throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
  const tree = await publicTree(db(), link.root.id);
  const { byId, children } = indexTree(tree);
  const folder = byId.get(folderId);
  if (!folder) throw new ApiError("NOT_FOUND");
  const busy = (await busyLevels([{ id: folder.id, dlPaused: folder.dlPaused || link.root.dlPaused }], now)).get(folder.id)!;
  if (busy.level === 2) throw busyError(busy, now);
  const path: string[] = [];
  for (let at: SharedRow | undefined = folder; at; at = at.id === link.root.id ? undefined : byId.get(at.parentId ?? "")) path.unshift(at.id);
  return { link, folder, children, byId, path, busy };
}

/**
 * Checks a link password. Wrong guesses are limited per link and address; a correct one
 * returns the new unlock cookie value (the password itself is never stored client-side).
 */
export async function unlockShare(linkId: string, password: string, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string> {
  const link = await loadLink(linkId, viewer, now);
  if (!link || link.status === "private") throw new ApiError("NOT_FOUND");
  const secret = cookieSecrets()[0]!;
  if (!link.root.passwordHash) return addUnlock(viewer.unlocks, linkId, secret, now);

  const key = `unlock:${linkId}:${client.ipKey}`;
  const attempts = await redis().incr(key);
  if (attempts === 1) await redis().expire(key, SHARE.unlockWindowSec);
  if (attempts > SHARE.unlockMaxAttempts) throw new ApiError("RATE_LIMITED", "Too many wrong passwords. Try again later.", { retryAfter: Math.max(1, await redis().ttl(key)) });
  if (!(await verify(link.root.passwordHash, password))) throw new ApiError("FORBIDDEN", "Wrong password");
  await redis().del(key);
  return addUnlock(viewer.unlocks, linkId, secret, now);
}

import "server-only";
import { verify } from "@node-rs/argon2";
import { getAppEnv, getEnv } from "@/config/env";
import { MS, SHARE } from "@/config/policy";
import type { ShareCrumb, ShareItem, SharePage, ShareView } from "@/contracts/share";
import { deletionDate } from "@/domain/account";
import { shareStatus, busyBadge, strictestGuard, type Busy, type ShareStatus } from "@/domain/share";
import { downloadBlock, type DownloadBlock } from "@/domain/share-access";
import { effectiveVisibility, type NodeKind, segmentsBelowRoot, type SettingTag, settingTags, sortNodes, type Visibility } from "@/domain/tree";
import type { ClientInfo } from "../auth/client-info";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { findAccountById } from "../repositories/account.repo";
import type { NodeRow } from "../repositories/node.repo";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import { findByLinkId, publicTree, sharedChain, type ChainRow, type SharedRow } from "../repositories/share.repo";
import { countInWindow, redis } from "../redis";
import { busyLevels } from "./busy";
import { addUnlock, isUnlocked, unlocksWith, type Unlocks } from "./unlock-cookie";

/** Who is looking at a share link. */
export interface ShareViewer {
  /** Accounts signed in on this device (the owner sees the visitor preview bar). */
  accountIds: readonly string[];
  unlocks: Unlocks;
  /** The browser's share visitor id (`rf_dv`), which resumed downloads are granted to. */
  visitorId: string | null;
}

const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;
const kindOf = (row: { kind: string | null }) => (row.kind ? (lower(row.kind) as NodeKind) : null);

export const shareUrl = (linkId: string) => `${getAppEnv().PUBLIC_URL}/d/${linkId}`;

/**
 * A link's settings, owner and status. Null when no item has this link. The status follows
 * the strictest settings from the account root down to the shared item (`strictestGuard`):
 * a folder above it that expired, was downloaded once as delete-after-download or has a
 * password closes or locks this link too, and so does the owner's account reaching its
 * deletion date.
 */
export async function loadLink(linkId: string, viewer: ShareViewer, now: number) {
  const root = await findByLinkId(db(), linkId);
  if (!root) return null;
  const [chain, owner] = await Promise.all([sharedChain(db(), root.id), findAccountById(db(), root.accountId)]);
  if (!owner) return null;
  const visibility = effectiveVisibility(chain.map((row) => lower(row.visibility) as Visibility).reverse());
  const guard = strictestGuard(
    chain.map((row) => ({
      expAt: row.expAt?.getTime() ?? null,
      burn: row.burn,
      downloads: row.downloads,
      hasPassword: row.passwordHash !== null,
      unlocked: isUnlocked(viewer.unlocks, row.linkId, row.passwordHash, cookieSecrets()),
    })),
    deletionDate(owner, getEnv("policy").ACCOUNT_TTL_DAYS)?.getTime() ?? null,
  );
  const status: ShareStatus = guard.burnUsed
    ? "expired"
    : shareStatus(
        {
          expAt: guard.expAt,
          burn: root.burn,
          downloads: root.downloads,
          downloadLimit: root.downloadLimit,
          effectiveVisibility: visibility,
          hasPassword: guard.hasPassword,
          unlocked: guard.unlocked,
        },
        now,
      );
  return { root, chain, owner, status, isOwner: viewer.accountIds.includes(root.accountId) };
}

export type LoadedLink = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

/** Tags under the share page title: settings without "Public" and the lock. */
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

/**
 * Stream only and paused downloads set on the items above a row, from the account root down
 * to its parent. Like passwords and expiry (`strictestGuard`), a folder's setting applies to
 * everything inside it, whichever link the item is opened through.
 */
export interface WayAbove {
  streamOnly: boolean;
  dlPaused: boolean;
}

type WayRow = Pick<SharedRow, "access" | "dlPaused">;
const NOTHING_ABOVE: WayAbove = { streamOnly: false, dlPaused: false };
const through = (way: WayAbove, row: WayRow): WayAbove => ({ streamOnly: way.streamOnly || row.access === "STREAM", dlPaused: way.dlPaused || row.dlPaused });

/** The way above the last row of a chain (account root first). */
const wayAboveEnd = (chain: readonly WayRow[]) => chain.slice(0, -1).reduce(through, NOTHING_ABOVE);

/** The way above each row of a link's tree, starting from the folders above the link itself. */
function wayAboveInTree(link: LoadedLink, byId: ReadonlyMap<string, SharedRow>): (row: SharedRow) => WayAbove {
  const aboveRoot = wayAboveEnd(link.chain);
  const known = new Map<string, WayAbove>();
  const wayAbove = (row: SharedRow): WayAbove => {
    if (row.id === link.root.id) return aboveRoot;
    const cached = known.get(row.id);
    if (cached) return cached;
    const parent = byId.get(row.parentId ?? "");
    const way = parent ? through(wayAbove(parent), parent) : aboveRoot;
    known.set(row.id, way);
    return way;
  };
  return wayAbove;
}

/** Whether downloads of a row are paused by an admin, on it or on a folder above it. */
export const pausedOn = (row: WayRow, above: WayAbove) => row.dlPaused || above.dlPaused;

/** Why visitors may not download this row now (null = they may), as on the share page. */
export function downloadBlockOf(row: SharedRow, above: WayAbove, busy: Busy | undefined): DownloadBlock | null {
  return downloadBlock({
    linkStreamOnly: above.streamOnly,
    streamOnly: row.access === "STREAM",
    downloadLimit: row.downloadLimit,
    downloads: row.downloads,
    burn: row.burn,
    busyLevel: busy?.level ?? 0,
  });
}

/** The open share page for a folder inside the link (or the shared file). Null if not inside. */
async function buildView(link: LoadedLink, folderId: string | null, now: number): Promise<ShareView | null> {
  const { root } = link;
  const tree = await publicTree(db(), root.id, new Date(now));
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
  const wayAbove = wayAboveInTree(link, byId);
  const busy = await busyLevels(
    [folder, ...sorted].map((row) => ({ id: row.id, dlPaused: pausedOn(row, wayAbove(row)) })),
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
    canDownload: downloadBlockOf(row, wayAbove(row), busy.get(row.id)) === null,
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
    // Only a link the visitor may open (or unlock) names its item: a private, expired or
    // used-up link says nothing about what it held.
    name: status === "open" || status === "locked" || isOwner ? root.name : "",
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
  /**
   * Items a visitor's download is counted on: the file, the link, and every item on the way
   * with its own download limit or delete-after-download (all checked by `claimDownload`).
   */
  counted: string[];
  /** One of them limits downloads, so playback is counted too (`limitedStreamDecision`). */
  limited: boolean;
  busy: Busy;
}

/** Items that limit downloads themselves: a download limit, or delete after the first download. */
export const limitingIds = (rows: readonly Pick<SharedRow, "id" | "burn" | "downloadLimit">[]) =>
  rows.filter((row) => row.burn || (row.downloadLimit !== null && row.downloadLimit > 0)).map((row) => row.id);

/** An item below the link that visitors of the link may not reach: private, protected by its own password, or expired. */
const closedBelowLink = (row: ChainRow, now: number) => row.visibility === "PRIVATE" || row.passwordHash !== null || (row.expAt !== null && row.expAt.getTime() <= now);

/**
 * Checks that a visitor may play or download a file through a link: the link is open, the
 * file is inside it and visible, and (for downloads) downloads are allowed and not paused.
 */
export async function resolveSharedFile(linkId: string, nodeId: string, viewer: ShareViewer, purpose: "stream" | "download", now: number): Promise<SharedFile> {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  if (link.status !== "open") throw statusError(link.status);
  // Only the way from the file up to the account root, not the link's whole tree (every
  // Range request of a video comes through here).
  const chain = await sharedChain(db(), nodeId);
  const rootAt = chain.findIndex((at) => at.id === link.root.id);
  const row = chain.at(-1);
  // Inside the link, and nothing between the link and the file is closed to it (as in publicTree).
  if (!row || row.id !== nodeId || row.type !== "FILE" || rootAt < 0 || chain.slice(rootAt + 1).some((at) => closedBelowLink(at, now))) throw new ApiError("NOT_FOUND");
  const path = chain.slice(rootAt).map((at) => at.id);
  const guarded = limitingIds(chain);
  const counted = [...new Set([row.id, link.root.id, ...guarded])];
  const above = wayAboveEnd(chain);
  const busy = (await busyLevels([{ id: row.id, dlPaused: pausedOn(row, above) }], now)).get(row.id)!;
  if (purpose === "download") {
    switch (downloadBlockOf(row, above, busy)) {
      case "stream-only":
        throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
      case "limit":
        throw new ApiError("FORBIDDEN", "Download limit reached");
      case "paused":
        throw busyError(busy, now);
      case null:
        break;
    }
  }
  return { link, row, path, segments: segmentsBelowRoot(chain), counted, limited: guarded.length > 0, busy };
}

/** Visible items of a link for "Download all" (zip), with the same checks as single downloads. */
export async function resolveSharedTree(linkId: string, folderId: string, viewer: ShareViewer, now: number) {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  if (link.status !== "open") throw statusError(link.status);
  const tree = await publicTree(db(), link.root.id, new Date(now));
  const { byId, children } = indexTree(tree);
  const folder = byId.get(folderId);
  if (!folder) throw new ApiError("NOT_FOUND");
  const wayAbove = wayAboveInTree(link, byId);
  const atFolder = through(wayAbove(folder), folder);
  if (atFolder.streamOnly) throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
  const busy = (await busyLevels([{ id: folder.id, dlPaused: atFolder.dlPaused }], now)).get(folder.id)!;
  if (busy.level === 2) throw busyError(busy, now);
  const path: string[] = [];
  for (let at: SharedRow | undefined = folder; at; at = at.id === link.root.id ? undefined : byId.get(at.parentId ?? "")) path.unshift(at.id);
  // Counted for a "Download all" like a single download: the folder, the link and every item
  // on the way that limits downloads (the files inside are counted one by one).
  const counted = [...new Set([folder.id, link.root.id, ...limitingIds(link.chain), ...limitingIds(path.map((id) => byId.get(id)!))])];
  return { link, folder, children, byId, path, counted, busy, wayAbove };
}

/**
 * Checks a password for a link. The link may need several (its own and those of folders
 * above it): the one entered unlocks every item on the way it belongs to, and the page asks
 * again while others are missing. Wrong guesses are limited per link and address; a correct
 * one returns the new unlock cookie value (the password itself is never stored client-side).
 */
export async function unlockShare(linkId: string, password: string, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string> {
  const link = await loadLink(linkId, viewer, now);
  if (!link || link.status === "private") throw new ApiError("NOT_FOUND");
  const secrets = cookieSecrets();
  const locked = link.chain.filter((row) => row.passwordHash !== null && !isUnlocked(viewer.unlocks, row.linkId, row.passwordHash, secrets));
  if (locked.length === 0) return addUnlock(viewer.unlocks, linkId, link.root.passwordHash, secrets[0]!, now);

  // Guesses count against each password still needed (the item holding it, not the link
  // used), so links to different items under the same locked folder share one budget.
  const keyOf = (row: ChainRow) => `unlock:${row.id}:${client.ipKey}`;
  const attempts = await Promise.all(locked.map((row) => countInWindow(keyOf(row), SHARE.unlockWindowSec)));
  const worst = attempts.indexOf(Math.max(...attempts));
  if (attempts[worst]! > SHARE.unlockMaxAttempts) {
    throw new ApiError("RATE_LIMITED", "Too many wrong passwords. Try again later.", { retryAfter: Math.max(1, await redis().ttl(keyOf(locked[worst]!))) });
  }
  const matching: ChainRow[] = [];
  for (const row of locked) if (await verify(row.passwordHash!, password)) matching.push(row);
  if (matching.length === 0) throw new ApiError("FORBIDDEN", "Wrong password");
  // A right password gives back only this attempt, on the items it opened: knowing one
  // password does not reset the guesses made at another (as with sign-in, refundTokenAttempt).
  await Promise.all(matching.map((row) => redis().decr(keyOf(row))));
  return unlocksWith(
    viewer.unlocks,
    matching.map((row) => ({ linkId: row.linkId, passwordHash: row.passwordHash })),
    secrets[0]!,
    now,
  );
}

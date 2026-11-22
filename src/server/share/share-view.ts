import "server-only";
import type { ShareItem, SharePage, ShareView } from "@/contracts/share";
import { busyBadge } from "@/domain/share";
import { type SettingTag, settingTags, sortNodes, type Visibility } from "@/domain/tree";
import { db } from "../db/client";
import type { NodeRow } from "../repositories/node.repo";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import type { ChildStats } from "../repositories/node-tree.repo";
import { publicChildren, publicChildStats, type SharedRow } from "../repositories/share.repo";
import { busyLevels } from "./busy";
import { chainTo, downloadBlockOf, kindOf, type LoadedLink, loadLink, lower, pausedOn, shareUrl, type ShareViewer, through, trailInLink, wayAboveEnd } from "./share-link";

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

/**
 * The open share page for a folder inside the link (or the shared file). Null if not inside.
 * Reads only that folder: its chain (for the crumbs and the settings above it), the items in it
 * and, in one aggregate query, what visitors may see inside each of them (bytes, item count).
 */
async function buildView(link: LoadedLink, folderId: string | null, now: number): Promise<ShareView | null> {
  const { root } = link;
  const fileLink = root.type === "FILE";
  // A file link shows its file whichever folder is asked for.
  const chain = await chainTo(link, fileLink ? root.id : (folderId ?? root.id));
  const trail = trailInLink(chain, root.id, now);
  const folder = trail?.at(-1);
  if (!trail || !folder || (!fileLink && folder.type !== "FOLDER")) return null;

  const at = new Date(now);
  const [listed, stats] = fileLink ? [[folder], new Map<string, ChildStats>()] : await Promise.all([publicChildren(db(), folder.id, at), publicChildStats(db(), folder.id, at)]);
  const sizeOf = (row: SharedRow) => (row.type === "FILE" ? row.size : (stats.get(row.id)?.size ?? 0n));
  const sorted = sortNodes(
    listed.map((row) => ({ row, type: lower(row.type) as "file" | "folder", name: row.name, kind: kindOf(row), size: Number(sizeOf(row)), createdAt: row.createdAt.getTime() })),
    "name",
  ).map((entry) => entry.row);
  const aboveFolder = wayAboveEnd(chain);
  // The file of a file link is the "folder" itself.
  const aboveItems = fileLink ? aboveFolder : through(aboveFolder, folder);
  const busy = await busyLevels(
    [{ id: folder.id, dlPaused: pausedOn(folder, aboveFolder) }, ...sorted.map((row) => ({ id: row.id, dlPaused: pausedOn(row, aboveItems) }))],
    now,
  );

  const items: ShareItem[] = sorted.map((row) => ({
    id: row.id,
    type: lower(row.type) as "file" | "folder",
    name: row.name,
    kind: kindOf(row),
    size: sizeOf(row).toString(),
    itemCount: stats.get(row.id)?.items ?? 0,
    busy: busyBadge(busy.get(row.id)!, now, "share"),
    canDownload: downloadBlockOf(row, aboveItems, busy.get(row.id)) === null,
    hasThumb: row.type === "FILE" && row.hasThumb,
  }));
  return {
    root: { id: root.id, type: fileLink ? "file" : "folder", kind: kindOf(root), createdAt: root.createdAt.toISOString() },
    folder: { id: folder.id, name: folder.name, parentId: folder.id === root.id ? null : folder.parentId },
    crumbs: trail.map(({ id, name }) => ({ id, name })),
    count: items.length,
    size: (fileLink ? folder.size : sorted.reduce((sum, row) => sum + sizeOf(row), 0n)).toString(),
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

import "server-only";
import type { ShareItem, SharePage, ShareView } from "@/contracts/share";
import { busyBadge } from "@/domain/share";
import { type SettingTag, settingTags, sortNodes, type Visibility } from "@/domain/tree";
import { db } from "../db/client";
import type { NodeRow } from "../repositories/node.repo";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import type { ChildStats } from "../repositories/node-tree.repo";
import { publicChildren, publicChildStats, publicItemStats, sharedChain, type SharedRow } from "../repositories/share.repo";
import { collectionEntries } from "./share-access";
import { busyLevels } from "./busy";
import { chainTo, type CollectionLink, downloadBlockOf, kindOf, linkTrail, linkWayAbove, type LoadedLink, loadLink, lower, pausedOn, shareUrl, type ShareViewer, through, type WayAbove, wayAboveEnd } from "./share-link";

/** The settings a share page shows as tags: an item's, or a collection's (always public). */
type TagSource = Pick<NodeRow, "expiryLabel" | "expAt" | "burn" | "downloadLimit" | "passwordHash" | "access" | "downloads"> & { visibility: NodeRow["visibility"] };

/** Tags under the share page title: settings without "Public" and the lock. */
function shareTags(root: TagSource, now: number): SettingTag[] {
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

/** The rows of a listing, sorted by name, as share page items (`aboveOf`: the way above each row). */
async function listItems(rows: readonly SharedRow[], stats: ReadonlyMap<string, ChildStats>, aboveOf: (row: SharedRow) => WayAbove, now: number) {
  const sizeOf = (row: SharedRow) => (row.type === "FILE" ? row.size : (stats.get(row.id)?.size ?? 0n));
  const sorted = sortNodes(
    rows.map((row) => ({ row, type: lower(row.type) as "file" | "folder", name: row.name, kind: kindOf(row), size: Number(sizeOf(row)), createdAt: row.createdAt.getTime() })),
    "name",
  ).map((entry) => entry.row);
  const busy = await busyLevels(sorted.map((row) => ({ id: row.id, dlPaused: pausedOn(row, aboveOf(row)) })), now);
  const items: ShareItem[] = sorted.map((row) => ({
    id: row.id,
    type: lower(row.type) as "file" | "folder",
    name: row.name,
    kind: kindOf(row),
    size: sizeOf(row).toString(),
    itemCount: stats.get(row.id)?.items ?? 0,
    busy: busyBadge(busy.get(row.id)!, now, "share"),
    canDownload: downloadBlockOf(row, aboveOf(row), busy.get(row.id)) === null,
    hasThumb: row.type === "FILE" && row.hasThumb,
    createdAt: row.createdAt.toISOString(),
  }));
  return { items, size: sorted.reduce((sum, row) => sum + sizeOf(row), 0n) };
}

/** What visitors may see directly in a folder of a link, with the folder's own busy badge. */
async function folderListing(folder: SharedRow, aboveFolder: WayAbove, now: number) {
  const at = new Date(now);
  const [listed, stats] = await Promise.all([publicChildren(db(), folder.id, at), publicChildStats(db(), folder.id, at)]);
  const aboveItems = through(aboveFolder, folder);
  const [listing, busy] = await Promise.all([listItems(listed, stats, () => aboveItems, now), busyLevels([{ id: folder.id, dlPaused: pausedOn(folder, aboveFolder) }], now)]);
  return { ...listing, folderBusy: busyBadge(busy.get(folder.id)!, now, "share") };
}

/**
 * The open share page for a folder inside the link (or the shared file). Null if not inside.
 * Reads only that folder: its chain (for the crumbs and the settings above it), the items in it
 * and, in one aggregate query, what visitors may see inside each of them (bytes, item count).
 */
async function buildView(link: LoadedLink, folderId: string | null, now: number): Promise<ShareView | null> {
  if (link.kind === "collection") return buildCollectionView(link, folderId, now);
  const { root } = link;
  const fileLink = root.type === "FILE";
  // A file link shows its file whichever folder is asked for.
  const chain = await chainTo(link, fileLink ? root.id : (folderId ?? root.id));
  const trail = linkTrail(link, chain, now);
  const folder = trail?.at(-1);
  if (!trail || !folder || (!fileLink && folder.type !== "FOLDER")) return null;

  const aboveFolder = wayAboveEnd(chain);
  // The file of a file link is the "folder" itself, and the only item.
  const listing = fileLink
    ? { ...(await listItems([folder], new Map(), () => aboveFolder, now)), folderBusy: null }
    : await folderListing(folder, aboveFolder, now);
  return {
    root: { id: root.id, type: fileLink ? "file" : "folder", kind: kindOf(root), createdAt: root.createdAt.toISOString() },
    folder: { id: folder.id, name: folder.name, parentId: folder.id === root.id ? null : folder.parentId },
    crumbs: trail.map(({ id, name }) => ({ id, name })),
    count: listing.items.length,
    size: listing.size.toString(),
    tags: shareTags(root, now),
    note: folder.id === root.id && root.note ? root.note : null,
    downloadsAllowed: root.access !== "STREAM",
    // A file link's file is its only item: its busy badge is the "folder's".
    folderBusy: fileLink ? (listing.items[0]?.busy ?? null) : listing.folderBusy,
    items: listing.items,
  };
}

/**
 * A collection's page: its items at the top (a folder named after it), or a folder inside one of
 * them. Crumbs start at the collection.
 */
async function buildCollectionView(link: CollectionLink, folderId: string | null, now: number): Promise<ShareView | null> {
  const { collection } = link;
  const top = { id: collection.id, name: collection.name };
  const common = {
    root: { id: collection.id, type: "folder" as const, kind: null, createdAt: collection.createdAt.toISOString() },
    tags: shareTags({ ...collection, visibility: "PUBLIC" }, now),
    downloadsAllowed: collection.access !== "STREAM",
  };
  if (folderId === null || folderId === collection.id) {
    const entries = await collectionEntries(link, now);
    const stats = await publicItemStats(db(), entries.filter(({ row }) => row.type === "FOLDER").map(({ row }) => row.id), new Date(now));
    const aboveOf = new Map(entries.map(({ row, chain }) => [row.id, linkWayAbove(link, chain)]));
    const listing = await listItems(
      entries.map(({ row }) => row),
      stats,
      (row) => aboveOf.get(row.id)!,
      now,
    );
    return { ...common, folder: { ...top, parentId: null }, crumbs: [top], count: listing.items.length, size: listing.size.toString(), note: collection.note || null, folderBusy: null, items: listing.items };
  }
  const chain = await sharedChain(db(), folderId);
  const trail = linkTrail(link, chain, now);
  const folder = trail?.at(-1);
  if (!trail || !folder || folder.type !== "FOLDER") return null;
  const listing = await folderListing(folder, linkWayAbove(link, chain), now);
  return {
    ...common,
    // The collection item itself goes back to the collection.
    folder: { id: folder.id, name: folder.name, parentId: trail.length === 1 ? collection.id : folder.parentId },
    crumbs: [top, ...trail.map(({ id, name }) => ({ id, name }))],
    count: listing.items.length,
    size: listing.size.toString(),
    note: null,
    folderBusy: listing.folderBusy,
    items: listing.items,
  };
}

/** Where "Back to app" goes: the shared folder, or the folder holding a shared file (a collection: the files). */
function ownerLinks(link: LoadedLink): NonNullable<SharePage["owner"]> {
  if (link.kind === "collection") return { nodeId: link.collection.id, folderId: "", isRootFolder: true };
  const { root, chain } = link;
  const folderId = root.type === "FOLDER" ? root.id : chain.at(-2)!.id;
  return { nodeId: root.id, folderId, isRootFolder: folderId === chain[0]!.id };
}

/** Everything the share page needs. Null when the link (or the folder in it) does not exist. */
export async function sharePage(linkId: string, folderId: string | null, viewer: ShareViewer, now: number): Promise<{ page: SharePage; link: LoadedLink } | null> {
  const link = await loadLink(linkId, viewer, now);
  if (!link) return null;
  const { status, isOwner } = link;
  const view = status === "open" ? await buildView(link, folderId, now) : null;
  if (status === "open" && !view) return null;
  const page: SharePage = {
    linkId,
    url: shareUrl(linkId),
    status,
    // Only a link the visitor may open (or unlock) names its item: a private, expired or
    // used-up link says nothing about what it held.
    name: status === "open" || status === "locked" || isOwner ? (link.kind === "node" ? link.root.name : link.collection.name) : "",
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

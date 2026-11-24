import "server-only";
import { MS, SCAN, SHARE } from "@/config/policy";
import { type Busy, BUSY, type ShareStatus } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import { publicTree, publicTreeSize, sharedChain, sharedChains, type ChainRow, type SharedRow } from "../repositories/share.repo";
import { busyLevels } from "./busy";
import { cappedOn, type CappedItem } from "./traffic-cap";
import { limitingIds } from "@/domain/share-limits";
import { scanBlock } from "@/domain/scan";
import { chainTo, type CollectionLink, collectionIdOf, downloadBlockOf, linkTrail, linkWayAbove, type LoadedLink, loadLink, pausedOn, type ShareViewer, through, wayAboveInTree } from "./share-link";

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
  /** The collection the link belongs to, counted with them (null for an item's own link). */
  collectionId: string | null;
  /** One of them limits downloads, so playback is counted too (`limitedStreamDecision`). */
  limited: boolean;
  busy: Busy;
  /** Items from the account root down to the file with their own daily traffic limit. */
  capped: CappedItem[];
}


/** A link visitors may open now: 404/410 for one that does not exist, the card's error for a closed one. */
export async function openLink(linkId: string, viewer: ShareViewer, now: number, resuming = false): Promise<LoadedLink> {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  // A download counted before the limit was reached may still be continued (see resolveSharedFile).
  if (link.status !== "open" && !(resuming && link.status === "blocked")) throw statusError(link.status);
  return link;
}

/** A collection with a download limit or delete-after-download counts playback like its items' do. */
const hasLimit = (link: LoadedLink) => link.kind === "collection" && (link.collection.burn || (link.collection.downloadLimit ?? 0) > 0);

/**
 * Checks that a visitor may play or download a file through a link: the link is open, the
 * file is inside it and visible, and (for downloads) downloads are allowed and not paused.
 * `resuming`: this browser was counted for this file before and asks for bytes past the start,
 * so download limits used up since (by that very download, say) do not stop it here; whether
 * the response continues that download or counts as a new one is decided by the caller.
 */
export async function resolveSharedFile(linkId: string, nodeId: string, viewer: ShareViewer, purpose: "stream" | "download", now: number, resuming = false): Promise<SharedFile> {
  const link = await openLink(linkId, viewer, now, resuming);
  // Only the way from the file up to the account root, not the link's whole tree (every
  // Range request of a video comes through here).
  const chain = await sharedChain(db(), nodeId);
  // Inside the link, and nothing between the link and the file is closed to it (as in publicTree).
  const trail = linkTrail(link, chain, now);
  const row = chain.at(-1);
  if (!trail || !row || row.id !== nodeId || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  // A file received through an upload-only link reaches visitors only once the virus scan found it clean.
  if (!link.isOwner) {
    const scan = scanBlock(row.scanState);
    if (scan === "scanning") throw new ApiError("SCAN_PENDING", undefined, { retryAfter: SCAN.pendingRetrySec });
    if (scan === "blocked") throw new ApiError("FILE_BLOCKED");
  }
  const path = trail.map((at) => at.id);
  const guarded = limitingIds(chain);
  // A node link counts on its item; a collection on itself (collectionId).
  const counted = [...new Set([row.id, ...(link.kind === "node" ? [link.root.id] : []), ...guarded])];
  const above = linkWayAbove(link, chain);
  const busy = (await busyLevels([{ id: row.id, dlPaused: pausedOn(row, above) }], now)).get(row.id)!;
  if (purpose === "download") {
    switch (downloadBlockOf(row, above, busy)) {
      case "stream-only":
        throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
      case "limit":
        if (resuming) break;
        throw new ApiError("FORBIDDEN", "Download limit reached");
      case "paused":
        throw busyError(busy, now);
      case null:
        break;
    }
  }
  const collectionId = collectionIdOf(link);
  return { link, row, path, segments: segmentsBelowRoot(chain), counted, collectionId, limited: guarded.length > 0 || hasLimit(link), busy, capped: cappedOn(chain) };
}

/**
 * A folder of a link for "Download all" (zip), with the same checks as single downloads. Reads
 * only its chain; the zip reads what is inside with {@link sharedFolderTree}.
 */
export async function resolveSharedFolder(link: LoadedLink, folderId: string, now: number) {
  const chain = await chainTo(link, folderId);
  const trail = linkTrail(link, chain, now);
  const folder = trail?.at(-1);
  if (!trail || !folder || folder.type !== "FOLDER") throw new ApiError("NOT_FOUND");
  const aboveFolder = linkWayAbove(link, chain);
  const atFolder = through(aboveFolder, folder);
  if (atFolder.streamOnly) throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
  const busy = (await busyLevels([{ id: folder.id, dlPaused: atFolder.dlPaused }], now)).get(folder.id)!;
  if (busy.level === BUSY.paused) throw busyError(busy, now);
  const path = trail.map((at) => at.id);
  // Counted for a "Download all" like a single download: the folder, the link and every item
  // on the way that limits downloads (the files inside are counted one by one).
  const counted = [...new Set([folder.id, ...(link.kind === "node" ? [link.root.id, ...limitingIds(link.chain)] : []), ...limitingIds(chain)])];
  return { link, folder, chain, aboveFolder, path, counted, collectionId: collectionIdOf(link), busy, capped: cappedOn(chain) };
}

export type SharedFolder = Awaited<ReturnType<typeof resolveSharedFolder>>;

/** Rows a zip reads at most: the folder itself, SHARE.zipMaxItems items and one more to tell a larger folder. */
const zipReadLimit = () => SHARE.zipMaxItems + 2;

/** Refuses a zip of more than SHARE.zipMaxItems items. */
function assertZipItems(items: number): void {
  if (items > SHARE.zipMaxItems) {
    throw new ApiError("PAYLOAD_TOO_LARGE", `This folder holds more than ${SHARE.zipMaxItems.toLocaleString("en-US")} items. Download the folders inside it one by one.`);
  }
}

/** HEAD for "Download all": refuses a folder too large to zip, counting its items without reading them. */
export async function assertSharedFolderZippable(shared: SharedFolder, now: number): Promise<void> {
  // The folder itself is not an item of its zip.
  assertZipItems((await publicTreeSize(db(), shared.folder.id, new Date(now), zipReadLimit())) - 1);
}

/** Everything visitors may see inside a shared folder, for its zip (at most SHARE.zipMaxItems items). */
export async function sharedFolderTree(shared: SharedFolder, now: number) {
  const rows = await publicTree(db(), shared.folder.id, new Date(now), zipReadLimit());
  assertZipItems(rows.length - 1);
  return { rows, wayAbove: wayAboveInTree(shared.folder, shared.aboveFolder, new Map(rows.map((row) => [row.id, row]))) };
}

export type SharedFolderTree = Awaited<ReturnType<typeof sharedFolderTree>>;

/** A collection item visitors may see, with its chain from the account root down. */
export interface CollectionEntry {
  row: ChainRow;
  chain: ChainRow[];
}

/**
 * The items of a collection link that visitors may see, in the collection's order (one query
 * for every chain): items deleted since are gone, items behind a password, expired or under a
 * used delete-after-download item are left out (`linkTrail`).
 */
export async function collectionEntries(link: CollectionLink, now: number): Promise<CollectionEntry[]> {
  const chains = await sharedChains(db(), link.collection.nodeIds);
  return link.collection.nodeIds.flatMap((id) => {
    const chain = chains.get(id);
    const row = chain?.at(-1);
    return chain && row?.id === id && linkTrail(link, chain, now) ? [{ row, chain }] : [];
  });
}

/**
 * What visitors may see inside each folder of a collection (the folder first), for "Download
 * all" of the collection: SHARE.zipMaxItems items at most in all, items themselves included.
 */
export async function collectionTrees(entries: readonly CollectionEntry[], now: number): Promise<Map<string, SharedRow[]>> {
  const trees = new Map<string, SharedRow[]>();
  let items = 0;
  for (const { row } of entries) {
    if (row.type === "FOLDER") {
      const rows = await publicTree(db(), row.id, new Date(now), zipReadLimit());
      trees.set(row.id, rows);
      items += rows.length;
    } else items += 1;
    assertZipItems(items);
  }
  return trees;
}

/** HEAD for "Download all" of a collection: refuses one too large to zip, counting without reading rows. */
export async function assertCollectionZippable(entries: readonly CollectionEntry[], now: number): Promise<void> {
  let items = 0;
  for (const { row } of entries) {
    items += row.type === "FOLDER" ? await publicTreeSize(db(), row.id, new Date(now), zipReadLimit()) : 1;
    assertZipItems(items);
  }
}

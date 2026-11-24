import "server-only";
import { MS, SCAN, SHARE } from "@/config/policy";
import { type Busy, BUSY, type ShareStatus } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { isRetiredLink } from "../repositories/link-tombstone.repo";
import { publicTree, publicTreeSize, sharedChain, type SharedRow } from "../repositories/share.repo";
import { busyLevels } from "./busy";
import { cappedOn, type CappedItem } from "./traffic-cap";
import { limitingIds } from "@/domain/share-limits";
import { scanBlock } from "@/domain/scan";
import { chainTo, downloadBlockOf, type LoadedLink, loadLink, pausedOn, type ShareViewer, through, trailInLink, wayAboveEnd, wayAboveInTree } from "./share-link";

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
  /** Items from the account root down to the file with their own daily traffic limit. */
  capped: CappedItem[];
}


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
  // Inside the link, and nothing between the link and the file is closed to it (as in publicTree).
  const trail = trailInLink(chain, link.root.id, now);
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
  return { link, row, path, segments: segmentsBelowRoot(chain), counted, limited: guarded.length > 0, busy, capped: cappedOn(chain) };
}

/**
 * A folder of a link for "Download all" (zip), with the same checks as single downloads. Reads
 * only its chain; the zip reads what is inside with {@link sharedFolderTree}.
 */
export async function resolveSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, now: number) {
  const link = await loadLink(linkId, viewer, now);
  if (!link) throw await missingLinkError(linkId);
  if (link.status !== "open") throw statusError(link.status);
  const chain = await chainTo(link, folderId);
  const trail = trailInLink(chain, link.root.id, now);
  const folder = trail?.at(-1);
  if (!trail || !folder) throw new ApiError("NOT_FOUND");
  const aboveFolder = wayAboveEnd(chain);
  const atFolder = through(aboveFolder, folder);
  if (atFolder.streamOnly) throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
  const busy = (await busyLevels([{ id: folder.id, dlPaused: atFolder.dlPaused }], now)).get(folder.id)!;
  if (busy.level === BUSY.paused) throw busyError(busy, now);
  const path = trail.map((at) => at.id);
  // Counted for a "Download all" like a single download: the folder, the link and every item
  // on the way that limits downloads (the files inside are counted one by one).
  const counted = [...new Set([folder.id, link.root.id, ...limitingIds(link.chain), ...limitingIds(trail)])];
  return { link, folder, chain, aboveFolder, path, counted, busy, capped: cappedOn(chain) };
}

export type SharedFolder = Awaited<ReturnType<typeof resolveSharedFolder>>;

/** Rows a zip reads at most: the folder itself, SHARE.zipMaxItems items and one more to tell a larger folder. */
const zipReadLimit = () => SHARE.zipMaxItems + 2;

/** Refuses a zip of more than SHARE.zipMaxItems items (`rows`: the folder and what was read below it). */
function assertZipSize(rows: number): void {
  if (rows - 1 > SHARE.zipMaxItems) {
    throw new ApiError("PAYLOAD_TOO_LARGE", `This folder holds more than ${SHARE.zipMaxItems.toLocaleString("en-US")} items. Download the folders inside it one by one.`);
  }
}

/** HEAD for "Download all": refuses a folder too large to zip, counting its items without reading them. */
export async function assertSharedFolderZippable(shared: SharedFolder, now: number): Promise<void> {
  assertZipSize(await publicTreeSize(db(), shared.folder.id, new Date(now), zipReadLimit()));
}

/** Everything visitors may see inside a shared folder, for its zip (at most SHARE.zipMaxItems items). */
export async function sharedFolderTree(shared: SharedFolder, now: number) {
  const rows = await publicTree(db(), shared.folder.id, new Date(now), zipReadLimit());
  assertZipSize(rows.length);
  return { rows, wayAbove: wayAboveInTree(shared.folder, shared.aboveFolder, new Map(rows.map((row) => [row.id, row]))) };
}

export type SharedFolderTree = Awaited<ReturnType<typeof sharedFolderTree>>;

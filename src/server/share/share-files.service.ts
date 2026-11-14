import "server-only";
import { Readable } from "node:stream";
import { MEDIA, SHARE } from "@/config/policy";
import { PREFETCH_HEADER, SUBTITLE_PARAM } from "@/contracts/api";
import { isSubtitleName } from "@/domain/subtitles";
import { subtreePaths } from "@/domain/subtree";
import { effectiveRange, parseRange, zipName } from "@/domain/serving";
import { downloadDecision, limitedStreamDecision, streamReach, withinReach, type DownloadBlock, type DownloadDecision } from "@/domain/share-access";
import { mimeFromName } from "@/domain/upload";
import type { ClientInfo } from "../auth/client-info";
import { countInWindow } from "../redis";
import { noteUsedUp } from "./link-notify";
import { downloadsUsedUp, limitingFoldersBelow, type LimitFacts } from "@/domain/share-limits";
import { db } from "../db/client";
import type { Busy } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { sendFile } from "../http/send-file";
import { sendAsset, sendThumb } from "../http/send-thumb";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { canStripType } from "../media/process";
import { copySatisfies, shareStripMode } from "../media/strip-mode";
import { transcodeResponse } from "../media/transcode";
import { notePlay, sendStoredTranscode } from "../media/transcode-cache";
import type { AccountRow } from "../repositories/account.repo";
import { claimDownload, claimEachDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { assertShareTraffic, countLinkTraffic } from "./traffic-cap";
import { busyLevels, recordDownload } from "./busy";
import { grantDownload, hasDownloadGrant } from "./download-grant";
import { logLinkEvent } from "./events";
import { newVisitorId, setVisitorCookie } from "./visitor-cookie";
import type { ByteSource, StorageDriver, StorageLocation } from "../storage/driver";
import {
  assertSharedFolderZippable,
  downloadBlockOf,
  kindOf,
  pausedOn,
  resolveSharedFile,
  resolveSharedFolder,
  sharedFolderTree,
  type SharedFile,
  type SharedFolder,
  type SharedFolderTree,
  type ShareViewer,
} from "./share.service";
import { driverForAccount } from "../services/volume.service";
import { zipResponse, type ZipEntry } from "../services/zip.service";
import { markActive } from "../metrics/activity";
import { scanBlock } from "@/domain/scan";


/** Whether visitors get this photo or video as the worker's copy without metadata (SHARE_METADATA_STRIP and the owner's setting). */
const stripsMedia = (owner: AccountRow, row: Pick<SharedRow, "kind">) => owner.stripMetadataOnShare && shareStripMode() !== "none" && (row.kind === "IMAGE" || row.kind === "VIDEO");

/** Why a photo or video that must be sent without metadata cannot be sent now, or null when its clean copy exists. */
function publicImageBlock(row: Pick<SharedRow, "kind" | "hasDerived" | "stripFailed" | "derivedMode" | "mime" | "name">): "location" | "not-ready" | null {
  const mode = shareStripMode();
  // A copy made in a mode that kept more than is now wanted waits for a new one (503, queued again).
  if (row.hasDerived && mode !== "none" && copySatisfies(row.derivedMode, mode)) return null;
  // A type the worker cannot clean, or a file it failed on (undecodable, too large): never sent as is.
  if (row.stripFailed || !canStripType(row.mime ?? mimeFromName(row.name), row.kind === "VIDEO" ? "VIDEO" : "IMAGE")) return "location";
  return "not-ready";
}

/**
 * Bytes of an image as visitors get it: the worker's metadata-stripped copy, streamed from
 * disk range by range. Nothing is decoded in the request: until the worker made the copy the
 * visitor gets 503 with Retry-After (the file is queued again), and a file the worker could
 * not clean gets 415. Holding images in memory per request let anonymous visitors exhaust the
 * app's memory with a folder of large or broken photos.
 */
async function publicImage(driver: StorageDriver, location: StorageLocation, row: SharedRow): Promise<ByteSource> {
  switch (publicImageBlock(row)) {
    case "location":
      throw new ApiError("UNSUPPORTED_MEDIA");
    case "not-ready":
      void enqueueMedia([row.id]);
      throw new ApiError("MEDIA_NOT_READY", undefined, { retryAfter: MEDIA.stripPendingRetrySec });
    case null:
      break;
  }
  const asset = await driver.assetSource({ kind: "derived", accountId: location.accountId, nodeId: row.id });
  if (!asset) {
    // The copy went missing on disk: make it again.
    void enqueueMedia([row.id]);
    throw new ApiError("MEDIA_NOT_READY", undefined, { retryAfter: MEDIA.stripPendingRetrySec });
  }
  return asset;
}


/**
 * Counts a visitor's download start on the file, the link and every item on the way that
 * limits downloads (atomically against their limits), lets this browser resume it, and
 * records it for the busy level and activity. Returns the visitor id the grant belongs to.
 */
async function countSharedDownload(file: SharedFile, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string> {
  const { row } = file;
  const claimed = await claimDownload(db(), file.counted);
  if (!claimed) throw new ApiError("FORBIDDEN", "Download limit reached");
  noteUsedUp(file.link.root.accountId, claimed.usedUp);
  const visitorId = viewer.visitorId ?? newVisitorId();
  // Already counted: a Redis hiccup only costs the visitor resuming, never the download itself
  // (a delete-after-download file would otherwise be used up without anyone receiving it).
  await grantDownload(row.id, visitorId).catch((error: unknown) => logger.warn("download grant not stored", { error }));
  await recordDownload(file.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
  void logLinkEvent(row, "DOWNLOAD", client);
  return visitorId;
}

/** Applies a download decision; returns a new visitor id when one was created for the grant. */
async function applyDecision(decision: DownloadDecision, file: SharedFile, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string | null> {
  switch (decision) {
    case "count": {
      const visitorId = await countSharedDownload(file, viewer, client, now);
      return visitorId === viewer.visitorId ? null : visitorId;
    }
    case "deny":
      throw new ApiError("FORBIDDEN", "Start the download again.");
    case "allow":
      return null;
  }
}

/** A visitor's playback (`stream`) or download of a file inside a share link. */
export async function serveSharedFile(req: Request, linkId: string, nodeId: string, mode: "stream" | "download", viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const file = await resolveSharedFile(linkId, nodeId, viewer, mode, now);
  const { link, row } = file;
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  const driver = await driverForAccount(owner);
  const location = { accountId: owner.id, segments: file.segments };
  const body = stripsMedia(owner, row) ? await publicImage(driver, location, row) : undefined;
  const size = body ? body.size : Number(row.size);
  const etag = row.sha256 ? `${row.sha256}${body ? "-public" : ""}` : null;
  // What this response will cover, as sendFile and Nginx (X-Accel) decide it: Range, unless a
  // non-matching If-Range asks for the whole file.
  const range = effectiveRange(req.headers.get("range"), req.headers.get("if-range"), etag, size);

  // A visitor past the link's or the account's traffic for the day gets 429 before anything is counted.
  if (!link.isOwner && req.method === "GET") await assertShareTraffic(owner, file.capped, now);
  let newVisitor: string | null = null;
  if (mode === "download") {
    const granted = !link.isOwner && range !== null && range !== "unsatisfiable" && range.start > 0 && (await hasDownloadGrant(row.id, viewer.visitorId));
    newVisitor = await applyDecision(downloadDecision({ method: req.method, range, owner: link.isOwner, granted }), file, viewer, client, now);
  } else if (!link.isOwner) {
    // Playback reads what the viewer needs, not a second (uncounted) download of any file.
    const reach = streamReach(row.name, kindOf(row));
    if (reach === null) throw new ApiError("NOT_FOUND");
    if (!withinReach(reach, range, size)) throw new ApiError("FORBIDDEN", "Use Download to get the whole file.");
    // A file under a download limit or delete-after-download: playing it counts as well.
    if (file.limited) newVisitor = await applyDecision(limitedStreamDecision({ method: req.method, range, granted: await hasDownloadGrant(row.id, viewer.visitorId) }), file, viewer, client, now);
    // Videos and audio are played; pictures and documents are looked at.
    const start = req.method === "GET" && (range === null || (range !== "unsatisfiable" && range.start === 0));
    // A video's subtitle file read by the player is not a view of that file (it still counts
    // toward a download limit above, like any playback).
    const subtitleRead = new URL(req.url).searchParams.get(SUBTITLE_PARAM.name) === SUBTITLE_PARAM.value && isSubtitleName(row.name);
    if (start && !subtitleRead) void logLinkEvent(row, row.kind === "VIDEO" || row.kind === "AUDIO" ? "PLAY" : "VIEW", client);
  }
  if (mode === "stream" && req.method === "GET") void markActive("stream", `${row.id}:${client.ipKey}`);
  const response = await sendFile(req, {
    driver,
    location,
    name: row.name,
    mime: row.mime ?? mimeFromName(row.name),
    size,
    etag,
    mode,
    body,
    rateLimit: file.busy.level === 1 ? SHARE.throttledBytesPerSec : undefined,
    onServe: (bytes) => {
      if (req.method === "HEAD" || bytes === 0) return;
      addTraffic(db(), owner.id, BigInt(bytes), new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
      if (!link.isOwner) countLinkTraffic(file.capped, BigInt(bytes));
    },
  });
  return newVisitor ? setVisitorCookie(response, newVisitor) : response;
}

/**
 * The list preview of a file inside a share link. Same access checks as playback; nothing is
 * counted or logged (opening the page is not a view). Thumbnails are re-encoded without
 * metadata, so they are safe whatever the owner's metadata setting.
 */
export async function serveSharedThumb(req: Request, linkId: string, nodeId: string, viewer: ShareViewer): Promise<Response> {
  const { link, row } = await resolveSharedFile(linkId, nodeId, viewer, "stream", Date.now());
  if (!row.hasThumb) throw new ApiError("NOT_FOUND");
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  return sendThumb(req, await driverForAccount(owner), owner.id, row);
}

/**
 * What the viewer shows a visitor for an image: the worker's screen-sized preview (re-encoded
 * without metadata, so safe whatever the owner's setting), else the same bytes as playback.
 * Counted as a view like playback, except the viewer's look-ahead for the next picture.
 */
export async function serveSharedPreview(req: Request, linkId: string, nodeId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const { link, row, limited } = await resolveSharedFile(linkId, nodeId, viewer, "stream", Date.now());
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  // A file under a download limit or delete-after-download goes through playback, which counts it.
  const preview = row.kind === "IMAGE" && !limited ? await sendAsset(req, await driverForAccount(owner), owner.id, row, "preview") : null;
  if (!preview) return serveSharedFile(req, linkId, nodeId, "stream", viewer, client);
  // The viewer's look-ahead for the next picture is not a view.
  const prefetch = req.headers.get(PREFETCH_HEADER) !== null;
  if (!link.isOwner && !prefetch && req.method === "GET") void logLinkEvent(row, "VIEW", client);
  return preview;
}

/** A visitor's playback of a video the browser cannot decode, converted while it plays. */
export async function serveSharedTranscode(req: Request, linkId: string, nodeId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const file = await resolveSharedFile(linkId, nodeId, viewer, "stream", now);
  const { link, row } = file;
  if (row.kind !== "VIDEO") throw new ApiError("NOT_FOUND");
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  if (!link.isOwner && req.method === "GET") await assertShareTraffic(owner, file.capped, now);
  const driver = await driverForAccount(owner);
  // A file under a download limit or delete-after-download: converted playback counts like
  // playback of the original. Only where the request starts matters, so the converted
  // video's length (unknown while it converts) is not needed.
  let newVisitor: string | null = null;
  if (!link.isOwner && file.limited) {
    // Live conversion ignores Range and sends the whole video, so a range no file could satisfy
    // is judged as a request for all of it rather than let through uncounted.
    const parsed = parseRange(req.headers.get("range"), UNKNOWN_LENGTH);
    const range = parsed === "unsatisfiable" ? null : parsed;
    newVisitor = await applyDecision(limitedStreamDecision({ method: req.method, range, granted: await hasDownloadGrant(row.id, viewer.visitorId) }), file, viewer, client, now);
  }
  if (req.method === "GET") {
    if (!link.isOwner) void logLinkEvent(row, "PLAY", client);
    void markActive("stream", `${row.id}:${client.ipKey}`);
  }
  const response = (await sendStoredTranscode(req, driver, owner.id, row)) ?? (await liveTranscode(req, driver, owner.id, file, row.id, link.isOwner ? `account:${owner.id}` : `visitor:${client.ipKey}`));
  return newVisitor ? setVisitorCookie(response, newVisitor) : response;
}

/** Length passed to parseRange when only the start of a request matters. */
const UNKNOWN_LENGTH = Number.MAX_SAFE_INTEGER;

async function liveTranscode(req: Request, driver: StorageDriver, accountId: string, file: SharedFile, nodeId: string, requester: string): Promise<Response> {
  const path = await driver.localPath({ accountId, segments: file.segments });
  if (!path) throw new ApiError("NOT_FOUND");
  if (req.method === "GET") void notePlay(nodeId);
  return transcodeResponse(req, path, requester);
}

/** Why a file is left out of "Download all", as written in "Not included.txt". */
type ZipSkip = DownloadBlock | "location" | "not-ready" | "scanning" | "blocked";

const SKIP_REASONS: Record<ZipSkip, string> = {
  "stream-only": "Stream only",
  limit: "Download limit reached",
  paused: "Downloads paused",
  location: "Photo or video that can't be shared without its location data",
  "not-ready": "Photo or video still being prepared for sharing, try again in a moment",
  scanning: "Still being checked for viruses, try again in a moment",
  blocked: "Couldn't be checked for viruses",
};

/** The files of a shared folder, with what keeps each one out of the zip (null = included). */
function zipPlan({ link, folder }: SharedFolder, { rows, wayAbove }: SharedFolderTree, owner: AccountRow, busy: Map<string, Busy>, inner: ReadonlyMap<string, readonly LimitFacts[]>) {
  const files: { row: SharedRow; name: string; segments: string[]; skip: ZipSkip | null }[] = [];
  const folders: string[] = [];
  for (const { row, segments } of subtreePaths(rows, folder.id)) {
    // The folder itself is the zip's top folder, named in every entry.
    if (row.id === folder.id) continue;
    const name = [folder.name, ...segments].join("/");
    if (row.type === "FOLDER") {
      folders.push(name);
      continue;
    }
    const imageBlock = stripsMedia(owner, row) ? publicImageBlock(row) : null;
    // A folder inside with its own download limit counts for the files below it, as when they
    // are downloaded one by one: once it has none left, its files stay out.
    const innerBlock = (inner.get(row.id) ?? []).some(downloadsUsedUp) ? "limit" : null;
    const skip = link.isOwner ? imageBlock : (scanBlock(row.scanState) ?? downloadBlockOf(row, wayAbove(row), busy.get(row.id)) ?? innerBlock ?? imageBlock);
    files.push({ row, name, segments, skip });
  }
  return { files, folders };
}

/** "Not included.txt": each left-out file with the reason, so a zip never silently drops files. */
function skippedNote(skipped: readonly { name: string; skip: ZipSkip }[]): string {
  const lines = skipped.map(({ name, skip }) => `${name}  (${SKIP_REASONS[skip]})`);
  return `These files are not included:\n\n${lines.join("\n")}\n`;
}

/**
 * "Download all": a zip of a folder inside a share link, with the same per-file rules as
 * single downloads (stream-only, download limits, paused files) and images cleaned like
 * single downloads. Each included file is counted like a single download of it.
 */
export async function zipSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const shared = await resolveSharedFolder(linkId, folderId, viewer, now);
  const { link, folder } = shared;
  const tree = await sharedFolderTree(shared, now);
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  if (!link.isOwner) await assertShareTraffic(owner, shared.capped, now);
  const driver = await driverForAccount(owner);
  const base = segmentsBelowRoot(shared.chain);

  const allFiles = tree.rows.filter((row) => row.type === "FILE");
  const busy = await busyLevels(
    allFiles.map((row) => ({ id: row.id, dlPaused: pausedOn(row, tree.wayAbove(row)) })),
    now,
  );
  // Folders inside the zipped one that limit downloads, per file (the zipped folder and those
  // above it are in shared.counted).
  const inner = limitingFoldersBelow(tree.rows, folder.id);
  const plan = zipPlan(shared, tree, owner, busy, inner);

  if (!link.isOwner) {
    const claimed = await claimDownload(db(), shared.counted);
    if (!claimed) throw new ApiError("FORBIDDEN", "Download limit reached");
    // Each limiting folder inside counts once for the zip; one at its limit by now leaves its files out.
    const innerOf = (file: (typeof plan.files)[number]) => (inner.get(file.row.id) ?? []).map((row) => row.id);
    const inside = await claimEachDownload(db(), [...new Set(plan.files.filter((file) => file.skip === null).flatMap(innerOf))]);
    for (const file of plan.files) if (file.skip === null && innerOf(file).some((id) => !inside.counted.has(id))) file.skip = "limit";
    // A file at its limit by now (a download finished meanwhile) is left out like one already used up.
    const included = plan.files.filter((file) => file.skip === null);
    const files = await claimEachDownload(db(), included.map((file) => file.row.id));
    for (const file of included) if (!files.counted.has(file.row.id)) file.skip = "limit";
    noteUsedUp(link.root.accountId, [...claimed.usedUp, ...inside.usedUp, ...files.usedUp]);
    await recordDownload(shared.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
    void logLinkEvent(folder, "DOWNLOAD", client);
  }

  const entries: ZipEntry[] = plan.folders.map((name) => ({ name, folder: true }));
  const skipped: { name: string; skip: ZipSkip }[] = [];
  let bytes = 0n;
  for (const file of plan.files) {
    if (file.skip !== null) {
      skipped.push({ name: file.name, skip: file.skip });
      continue;
    }
    bytes += file.row.size;
    const location = { accountId: owner.id, segments: [...base, ...file.segments] };
    const row = file.row;
    entries.push({
      name: file.name,
      open: stripsMedia(owner, row) ? async () => (await publicImage(driver, location, row)).open() : () => driver.createReadStream(location),
    });
  }
  if (skipped.length > 0) entries.push({ name: `${folder.name}/Not included.txt`, open: async () => Readable.from([Buffer.from(skippedNote(skipped))]) });
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  if (!link.isOwner) countLinkTraffic(shared.capped, bytes, now);
  return zipResponse(entries, zipName([{ name: folder.name, folder: true }], folder.name));
}

/** HEAD for "Download all": the same checks as the zip (its size too), without building or counting it. */
export async function checkSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: Pick<ClientInfo, "ipKey">): Promise<Response> {
  if ((await countInWindow(`zipcheck:${client.ipKey}`, SHARE.zipCheckWindowSec)) > SHARE.zipChecksPerAddress) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfter: SHARE.zipCheckWindowSec });
  }
  const now = Date.now();
  await assertSharedFolderZippable(await resolveSharedFolder(linkId, folderId, viewer, now), now);
  return new Response(null, { status: 200, headers: { "content-type": "application/zip", "cache-control": "private, no-store" } });
}

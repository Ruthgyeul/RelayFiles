import "server-only";
import { MEDIA, SHARE } from "@/config/policy";
import { PREFETCH_HEADER, SUBTITLE_PARAM } from "@/contracts/api";
import { isSubtitleName } from "@/domain/subtitles";
import { effectiveRange, parseRange } from "@/domain/serving";
import { downloadDecision, limitedStreamDecision, streamReach, withinReach, type DownloadDecision } from "@/domain/share-access";
import { mimeFromName } from "@/domain/upload";
import type { ClientInfo } from "../auth/client-info";
import { noteUsedUp } from "./link-notify";
import { db } from "../db/client";
import { sendFile } from "../http/send-file";
import { sendAsset, sendThumb } from "../http/send-thumb";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { canStripType } from "../media/process";
import { copySatisfies, shareStripMode } from "../media/strip-mode";
import { hlsRequestOf, hlsResponse, type HlsVideo } from "../media/hls-response";
import { transcodeResponse } from "../media/transcode";
import { notePlay, sendStoredTranscode } from "../media/transcode-cache";
import type { AccountRow } from "../repositories/account.repo";
import { claimDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { assertShareTraffic, countLinkTraffic } from "./traffic-cap";
import { recordDownload } from "./busy";
import { grantDownload, hasDownloadGrant } from "./download-grant";
import { logLinkEvent } from "./events";
import { newVisitorId, setVisitorCookie } from "./visitor-cookie";
import type { ByteSource, StorageDriver, StorageLocation } from "../storage/driver";
import { resolveSharedFile, type SharedFile } from "./share-access";
import { kindOf, type ShareViewer } from "./share-link";
import { driverForAccount } from "../services/volume.service";
import { markActive } from "../metrics/activity";
import { BUSY } from "@/domain/share";
import { isProcessedKind } from "../services/node-dto";


/** Whether visitors get this photo or video as the worker's copy without metadata (SHARE_METADATA_STRIP and the owner's setting). */
export const stripsMedia = (owner: AccountRow, row: Pick<SharedRow, "kind">) => owner.stripMetadataOnShare && shareStripMode() !== "none" && isProcessedKind(row.kind);

/** Why a photo or video that must be sent without metadata cannot be sent now, or null when its clean copy exists. */
export function publicImageBlock(row: Pick<SharedRow, "kind" | "hasDerived" | "stripFailed" | "derivedMode" | "mime" | "name">): "location" | "not-ready" | null {
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
export async function publicImage(driver: StorageDriver, location: StorageLocation, row: SharedRow): Promise<ByteSource> {
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
    rateLimit: file.busy.level === BUSY.throttled ? SHARE.throttledBytesPerSec : undefined,
    onServe: trafficOf(req, owner, file),
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
  // Converted playback counts toward the account's and the link's daily traffic like the original.
  const onServe = trafficOf(req, owner, file);
  const response = (await sendStoredTranscode(req, driver, owner.id, row, onServe)) ?? (await liveTranscode(req, driver, owner.id, file, row.id, link.isOwner ? `account:${owner.id}` : `visitor:${client.ipKey}`, onServe));
  return newVisitor ? setVisitorCookie(response, newVisitor) : response;
}

/**
 * A visitor's HLS playback of a video converted for seeking (`index.m3u8` or a segment). A file
 * under a download limit or delete-after-download is counted once, when its playlist is
 * opened (that grants the browser); segments then need the grant, so they are not a way
 * around the limit. Every segment counts toward the daily traffic limits.
 */
export async function serveSharedHls(req: Request, linkId: string, nodeId: string, name: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const file = await resolveSharedFile(linkId, nodeId, viewer, "stream", now);
  const { link, row } = file;
  if (row.kind !== "VIDEO") throw new ApiError("NOT_FOUND");
  const { owner } = link;
  if (!link.isOwner) await assertShareTraffic(owner, file.capped, now);
  const driver = await driverForAccount(owner);
  const path = await driver.localPath({ accountId: owner.id, segments: file.segments });
  if (!path) throw new ApiError("NOT_FOUND");
  const requester = link.isOwner ? `account:${owner.id}` : `visitor:${client.ipKey}`;
  const video: HlsVideo = { nodeId: row.id, path, version: row.sha256 ?? row.id, requester, newDir: () => driver.stagingPath() };
  const parsed = await hlsRequestOf(video, name);
  let newVisitor: string | null = null;
  if (parsed.request.kind === "playlist") {
    if (!link.isOwner && file.limited) {
      newVisitor = await applyDecision(limitedStreamDecision({ method: "GET", range: null, granted: await hasDownloadGrant(row.id, viewer.visitorId) }), file, viewer, client, now);
    }
    if (!link.isOwner) void logLinkEvent(row, "PLAY", client);
    void markActive("stream", `${row.id}:${client.ipKey}`);
    void notePlay(row.id);
  } else if (!link.isOwner && file.limited && !(await hasDownloadGrant(row.id, viewer.visitorId))) {
    throw new ApiError("FORBIDDEN", "Start the video again.");
  }
  const response = await hlsResponse(video, parsed, trafficOf(req, owner, file));
  return newVisitor ? setVisitorCookie(response, newVisitor) : response;
}

/** Length passed to parseRange when only the start of a request matters. */
const UNKNOWN_LENGTH = Number.MAX_SAFE_INTEGER;

async function liveTranscode(req: Request, driver: StorageDriver, accountId: string, file: SharedFile, nodeId: string, requester: string, onServe: (bytes: number) => void): Promise<Response> {
  const path = await driver.localPath({ accountId, segments: file.segments });
  if (!path) throw new ApiError("NOT_FOUND");
  if (req.method === "GET") void notePlay(nodeId);
  return transcodeResponse(req, path, requester, { onServe });
}

/** Counts bytes sent to a share visitor: the owner's account traffic, and every limited item on the way. */
function trafficOf(req: Request, owner: AccountRow, file: SharedFile): (bytes: number) => void {
  return (bytes) => {
    if (req.method === "HEAD" || bytes === 0) return;
    addTraffic(db(), owner.id, BigInt(bytes), new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
    if (!file.link.isOwner) countLinkTraffic(file.capped, BigInt(bytes));
  };
}

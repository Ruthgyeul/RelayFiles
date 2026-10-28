import "server-only";
import { Readable } from "node:stream";
import { MEDIA, SHARE } from "@/config/policy";
import { PREFETCH_HEADER } from "@/contracts/api";
import { effectiveRange, zipName } from "@/domain/serving";
import { downloadDecision, limitedStreamDecision, streamReach, withinReach, type DownloadBlock, type DownloadDecision } from "@/domain/share-access";
import type { NodeKind } from "@/domain/tree";
import { mimeFromName } from "@/domain/upload";
import type { ClientInfo } from "../auth/client-info";
import { db } from "../db/client";
import type { Busy } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { sendFile } from "../files/send-file";
import { sendAsset, sendThumb } from "../files/send-thumb";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { canStripType } from "../media/process";
import { transcodeResponse } from "../media/transcode";
import { findAccountById, type AccountRow } from "../repositories/account.repo";
import { ancestorChain } from "../repositories/node.repo";
import { claimDownload, claimEachDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { busyLevels, recordDownload } from "../share/busy";
import { grantDownload, hasDownloadGrant } from "../share/download-grant";
import { logLinkEvent } from "../share/events";
import { newVisitorId, setVisitorCookie } from "../share/visitor-cookie";
import type { ByteSource, StorageDriver, StorageLocation } from "../storage/driver";
import { downloadBlockOf, resolveSharedFile, resolveSharedTree, type LoadedLink, type SharedFile, type ShareViewer } from "./share.service";
import { driverForAccount } from "./volume.service";
import { zipResponse, type ZipEntry } from "./zip.service";
import { markActive } from "../metrics/activity";

/** The link owner's account (for the storage volume and the metadata setting). */
async function ownerOf(link: LoadedLink): Promise<AccountRow> {
  const owner = await findAccountById(db(), link.root.accountId);
  if (!owner) throw new ApiError("NOT_FOUND");
  return owner;
}

const stripsImage = (owner: AccountRow, row: Pick<SharedRow, "kind">) => owner.stripMetadataOnShare && row.kind === "IMAGE";

/** Why a photo that must be sent without metadata cannot be sent now, or null when its clean copy exists. */
function publicImageBlock(row: Pick<SharedRow, "hasDerived" | "stripFailed" | "mime" | "name">): "location" | "not-ready" | null {
  if (row.hasDerived) return null;
  // A type the worker cannot clean, or a file it failed on (undecodable, too large): never sent as is.
  if (row.stripFailed || !canStripType(row.mime ?? mimeFromName(row.name))) return "location";
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

const kindOf = (row: Pick<SharedRow, "kind">) => (row.kind ? (row.kind.toLowerCase() as NodeKind) : null);

/**
 * Counts a visitor's download start on the file, the link and every item on the way that
 * limits downloads (atomically against their limits), lets this browser resume it, and
 * records it for the busy level and activity. Returns the visitor id the grant belongs to.
 */
async function countSharedDownload(file: SharedFile, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string> {
  const { row } = file;
  if (!(await claimDownload(db(), file.counted))) throw new ApiError("FORBIDDEN", "Download limit reached");
  const visitorId = viewer.visitorId ?? newVisitorId();
  await grantDownload(row.id, visitorId);
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
  const owner = await ownerOf(link);
  const driver = await driverForAccount(owner);
  const location = { accountId: owner.id, segments: file.segments };
  const body = stripsImage(owner, row) ? await publicImage(driver, location, row) : undefined;
  const size = body ? body.size : Number(row.size);
  const etag = row.sha256 ? `${row.sha256}${body ? "-public" : ""}` : null;
  // What this response will cover, as sendFile and Nginx (X-Accel) decide it: Range, unless a
  // non-matching If-Range asks for the whole file.
  const range = effectiveRange(req.headers.get("range"), req.headers.get("if-range"), etag, size);

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
    if (start) void logLinkEvent(row, row.kind === "VIDEO" || row.kind === "AUDIO" ? "PLAY" : "VIEW", client);
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
  const owner = await ownerOf(link);
  return sendThumb(req, await driverForAccount(owner), owner.id, row);
}

/**
 * What the viewer shows a visitor for an image: the worker's screen-sized preview (re-encoded
 * without metadata, so safe whatever the owner's setting), else the same bytes as playback.
 * Counted as a view like playback, except the viewer's look-ahead for the next picture.
 */
export async function serveSharedPreview(req: Request, linkId: string, nodeId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const { link, row } = await resolveSharedFile(linkId, nodeId, viewer, "stream", Date.now());
  const owner = await ownerOf(link);
  const preview = row.kind === "IMAGE" ? await sendAsset(req, await driverForAccount(owner), owner.id, row, "preview") : null;
  if (!preview) return serveSharedFile(req, linkId, nodeId, "stream", viewer, client);
  // The viewer's look-ahead for the next picture is not a view.
  const prefetch = req.headers.get(PREFETCH_HEADER) !== null;
  if (!link.isOwner && !prefetch && req.method === "GET") void logLinkEvent(row, "VIEW", client);
  return preview;
}

/** A visitor's playback of a video the browser cannot decode, converted while it plays. */
export async function serveSharedTranscode(req: Request, linkId: string, nodeId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const file = await resolveSharedFile(linkId, nodeId, viewer, "stream", Date.now());
  const { link, row } = file;
  if (row.kind !== "VIDEO") throw new ApiError("NOT_FOUND");
  const owner = await ownerOf(link);
  const path = await (await driverForAccount(owner)).localPath({ accountId: owner.id, segments: file.segments });
  if (!path) throw new ApiError("NOT_FOUND");
  if (req.method === "GET") {
    if (!link.isOwner) void logLinkEvent(row, "PLAY", client);
    void markActive("stream", `${row.id}:${client.ipKey}`);
  }
  return transcodeResponse(req, path);
}

/** Why a file is left out of "Download all", as written in "Not included.txt". */
type ZipSkip = DownloadBlock | "location" | "not-ready";

const SKIP_REASONS: Record<ZipSkip, string> = {
  "stream-only": "Stream only",
  limit: "Download limit reached",
  paused: "Downloads paused",
  location: "Photo type that can't be shared without its location data",
  "not-ready": "Photo still being prepared for sharing, try again in a moment",
};

/** The files of a shared folder, with what keeps each one out of the zip (null = included). */
function zipPlan(shared: Awaited<ReturnType<typeof resolveSharedTree>>, owner: AccountRow, busy: Map<string, Busy>) {
  const { link, folder, children } = shared;
  const files: { row: SharedRow; name: string; segments: string[]; skip: ZipSkip | null }[] = [];
  const folders: string[] = [];
  const walk = (row: SharedRow, inZip: string[], onDisk: string[]) => {
    for (const child of children.get(row.id) ?? []) {
      const name = [...inZip, child.name].join("/");
      const segments = [...onDisk, child.name];
      if (child.type === "FOLDER") {
        folders.push(name);
        walk(child, [...inZip, child.name], segments);
        continue;
      }
      const imageBlock = stripsImage(owner, child) ? publicImageBlock(child) : null;
      const skip = link.isOwner ? imageBlock : (downloadBlockOf(child, link.root, busy.get(child.id)) ?? imageBlock);
      files.push({ row: child, name, segments, skip });
    }
  };
  return { files, folders, walk: () => walk(folder, [folder.name], []) };
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
  const shared = await resolveSharedTree(linkId, folderId, viewer, now);
  const { link, folder, children } = shared;
  const owner = await ownerOf(link);
  const driver = await driverForAccount(owner);
  const base = segmentsBelowRoot(await ancestorChain(db(), folder.id));

  const allFiles = [...children.values()].flat().filter((row) => row.type === "FILE");
  const busy = await busyLevels(
    allFiles.map((row) => ({ id: row.id, dlPaused: row.dlPaused || link.root.dlPaused })),
    now,
  );
  const plan = zipPlan(shared, owner, busy);
  plan.walk();

  if (!link.isOwner) {
    const claimed = await claimDownload(db(), shared.counted);
    if (!claimed) throw new ApiError("FORBIDDEN", "Download limit reached");
    // A file at its limit by now (a download finished meanwhile) is left out like one already used up.
    const included = plan.files.filter((file) => file.skip === null);
    const counted = await claimEachDownload(db(), included.map((file) => file.row.id));
    for (const file of included) if (!counted.has(file.row.id)) file.skip = "limit";
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
      open: stripsImage(owner, row) ? async () => (await publicImage(driver, location, row)).open() : () => driver.createReadStream(location),
    });
  }
  if (skipped.length > 0) entries.push({ name: `${folder.name}/Not included.txt`, open: async () => Readable.from([Buffer.from(skippedNote(skipped))]) });
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  return zipResponse(entries, zipName([{ name: folder.name, folder: true }], folder.name));
}

/** HEAD for "Download all": the same checks as the zip, without building or counting it. */
export async function checkSharedFolder(linkId: string, folderId: string, viewer: ShareViewer): Promise<Response> {
  await resolveSharedTree(linkId, folderId, viewer, Date.now());
  return new Response(null, { status: 200, headers: { "content-type": "application/zip", "cache-control": "private, no-store" } });
}

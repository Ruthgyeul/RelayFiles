import "server-only";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { SHARE } from "@/config/policy";
import { zipName } from "@/domain/serving";
import { mimeFromName } from "@/domain/upload";
import type { ClientInfo } from "../auth/client-info";
import { db } from "../db/client";
import { sendFile } from "../files/send-file";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { canStripType, strippedCopy } from "../media/process";
import { findAccountById, type AccountRow } from "../repositories/account.repo";
import { ancestorChain } from "../repositories/node.repo";
import { countDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { recordDownload } from "../share/busy";
import { logLinkEvent } from "../share/events";
import type { StorageDriver, StorageLocation } from "../storage/driver";
import { resolveSharedFile, resolveSharedTree, type LoadedLink, type ShareViewer } from "./share.service";
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

/**
 * Bytes of an image as visitors get it: the worker's metadata-stripped copy, or a copy
 * made now (and queued for the worker so the next request is instant). Types that cannot
 * be cleaned are refused rather than sent with their location data.
 */
async function publicImage(driver: StorageDriver, location: StorageLocation, row: SharedRow): Promise<Uint8Array> {
  if (row.hasDerived) {
    const asset = await driver.readAsset({ kind: "derived", accountId: location.accountId, nodeId: row.id });
    if (asset) return buffer(asset.stream);
  }
  const mime = row.mime ?? mimeFromName(row.name);
  const path = await driver.localPath(location);
  const copy = path && canStripType(mime) ? await strippedCopy(path, mime, Number(row.size)).catch(() => null) : null;
  if (!copy) throw new ApiError("UNSUPPORTED_MEDIA");
  void enqueueMedia([row.id]);
  return copy;
}

/** The first request of a playback or download (not a later Range request for seeking). */
const isStart = (req: Request) => req.method === "GET" && /^(|bytes=0-\d*)$/.test(req.headers.get("range")?.trim() ?? "");

/** A visitor's playback (`stream`) or download of a file inside a share link. */
export async function serveSharedFile(req: Request, linkId: string, nodeId: string, mode: "stream" | "download", viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const file = await resolveSharedFile(linkId, nodeId, viewer, mode, now);
  const { link, row } = file;
  const owner = await ownerOf(link);
  const driver = await driverForAccount(owner);
  const location = { accountId: owner.id, segments: file.segments };
  const body = stripsImage(owner, row) ? await publicImage(driver, location, row) : undefined;

  if (!link.isOwner && isStart(req)) {
    if (mode === "download") {
      await countDownload(db(), [row.id, link.root.id]);
      await recordDownload(file.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
      void logLinkEvent(row, "DOWNLOAD", client);
    } else {
      void logLinkEvent(row, row.kind === "IMAGE" ? "VIEW" : "PLAY", client);
    }
  }
  if (mode === "stream" && req.method === "GET") void markActive("stream", `${row.id}:${client.ipKey}`);
  return sendFile(req, {
    driver,
    location,
    name: row.name,
    mime: row.mime ?? mimeFromName(row.name),
    size: Number(row.size),
    etag: row.sha256 ? `${row.sha256}${body ? "-public" : ""}` : null,
    mode,
    body,
    rateLimit: file.busy.level === 1 ? SHARE.throttledBytesPerSec : undefined,
    onServe: (bytes) => {
      if (req.method === "HEAD" || bytes === 0) return;
      addTraffic(db(), owner.id, BigInt(bytes), new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
    },
  });
}

/** "Download all": a zip of a folder inside a share link, with images cleaned like single downloads. */
export async function zipSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const shared = await resolveSharedTree(linkId, folderId, viewer, now);
  const { link, folder, children } = shared;
  const owner = await ownerOf(link);
  const driver = await driverForAccount(owner);
  const base = (await ancestorChain(db(), folder.id)).slice(1).map((row) => row.name);

  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let bytes = 0n;
  const walk = (row: SharedRow, inZip: string[], onDisk: string[]) => {
    for (const child of children.get(row.id) ?? []) {
      const name = [...inZip, child.name].join("/");
      const segments = [...onDisk, child.name];
      if (child.type === "FOLDER") {
        entries.push({ name, folder: true });
        walk(child, [...inZip, child.name], segments);
      } else if (child.access === "STREAM") {
        skipped.push(name);
      } else if (stripsImage(owner, child) && !child.hasDerived && !canStripType(child.mime ?? mimeFromName(child.name))) {
        skipped.push(name);
      } else {
        bytes += child.size;
        const location = { accountId: owner.id, segments };
        entries.push({
          name,
          open: stripsImage(owner, child) ? async () => Readable.from([Buffer.from(await publicImage(driver, location, child))]) : () => driver.createReadStream(location),
        });
      }
    }
  };
  walk(folder, [folder.name], base);
  if (skipped.length > 0) {
    const note = `These files are not included (photo type that can't be shared without its location data, or stream-only):\n\n${skipped.join("\n")}\n`;
    entries.push({ name: `${folder.name}/Not included.txt`, open: async () => Readable.from([Buffer.from(note)]) });
  }
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  if (!link.isOwner) {
    await countDownload(db(), [folder.id, link.root.id]);
    await recordDownload(shared.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
    void logLinkEvent(folder, "DOWNLOAD", client);
  }
  return zipResponse(entries, zipName([{ name: folder.name, folder: true }], folder.name));
}

/** HEAD for "Download all": the same checks as the zip, without building or counting it. */
export async function checkSharedFolder(linkId: string, folderId: string, viewer: ShareViewer): Promise<Response> {
  await resolveSharedTree(linkId, folderId, viewer, Date.now());
  return new Response(null, { status: 200, headers: { "content-type": "application/zip", "cache-control": "private, no-store" } });
}

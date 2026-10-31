import "server-only";
import { access, constants, readFile } from "node:fs/promises";
import sharp from "sharp";
import { MEDIA } from "@/config/policy";
import { LOSSLESS_STRIP_TYPES, stripImageMetadata } from "@/domain/image-metadata";
import { db } from "../db/client";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob, setFileFacts, updateNode } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import { driverForAccount } from "../services/volume.service";
import { locationOf } from "../services/node-location";
import { checkVolume } from "../storage/volume";
import { dateTaken } from "./date-taken";
import { isTransientMediaError } from "./failure";
import { imagePreview, imageThumbnail, videoThumbnail, wantsPreview } from "./thumbnail";

/** Image types sharp can rewrite in the same format (metadata is dropped on output). */
const REENCODE: Readonly<Record<string, "gif" | "avif" | "tiff">> = { "image/gif": "gif", "image/avif": "avif", "image/tiff": "tiff" };

/** Whether {@link strippedCopy} can clean this image type. */
export const canStripType = (mime: string) => LOSSLESS_STRIP_TYPES.has(mime) || Object.hasOwn(REENCODE, mime);

/**
 * Copy of an image without location and camera data, in the original format: lossless
 * segment removal for JPEG/PNG/WebP, a same-format rewrite for GIF/AVIF/TIFF. Null when the
 * type cannot be cleaned (the share page then does not serve the image publicly as is).
 */
export async function strippedCopy(path: string, mime: string, size: number): Promise<Uint8Array | null> {
  if (size > MEDIA.maxStripBytes) return null;
  if (LOSSLESS_STRIP_TYPES.has(mime)) return stripImageMetadata(await readFile(path), mime);
  const format = REENCODE[mime];
  if (!format) return null;
  return sharp(path, { animated: format === "gif", limitInputPixels: MEDIA.maxInputPixels }).toFormat(format).toBuffer();
}

export interface MediaResult {
  thumb: boolean;
  derived: boolean;
  /** A viewer preview was stored (only when it is smaller than the original). */
  preview: boolean;
}

/**
 * Whether the original can still be read and its volume is the one mounted: then a failed
 * step blames the file. A volume that came off or a vanished original blames the storage.
 */
async function storageReadable(path: string, volumeId: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    const volume = await findVolume(db(), volumeId);
    return volume !== null && (await checkVolume(volume.mountPath, volume.id)).state === "online";
  } catch {
    return false;
  }
}

/**
 * Runs one step. A file that cannot be decoded is logged and skipped (not retried). A storage
 * or system failure (I/O error, full disk, volume offline, a timeout, or a decoder error while
 * the original or its volume is unreadable) is thrown, so BullMQ tries the whole job again
 * with backoff and nothing is recorded for good.
 */
async function attempt<T>(step: string, nodeId: string, run: () => Promise<T>, source: { path: string; volumeId: string }): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (isTransientMediaError(error) || !(await storageReadable(source.path, source.volumeId))) {
      logger.warn("media step failed; retrying later", { step, nodeId, error });
      throw error;
    }
    logger.warn("media step failed", { step, nodeId, error });
    return null;
  }
}

/**
 * Builds the thumbnail (images and videos) and the metadata-stripped copy (images) of a
 * file. Idempotent: reruns overwrite the assets. Returns null when there is nothing to do.
 */
export async function processMedia(nodeId: string): Promise<MediaResult | null> {
  const row = await findNodeForJob(db(), nodeId);
  if (!row || row.type !== "FILE" || (row.kind !== "IMAGE" && row.kind !== "VIDEO")) return null;
  const account = await findAccountById(db(), row.accountId);
  if (!account) return null;
  const driver = await driverForAccount(account, "write");
  const path = await driver.localPath(await locationOf(row.accountId, row.id));
  if (!path) throw new Error("Media processing needs a local volume.");
  const mime = row.mime ?? "";
  const asset = { accountId: row.accountId, nodeId: row.id };
  const source = { path, volumeId: account.volumeId };

  const thumb = await attempt("thumbnail", row.id, () => (row.kind === "VIDEO" ? videoThumbnail(path) : imageThumbnail(path)), source);
  if (thumb) await driver.writeAsset({ ...asset, kind: "thumb" }, thumb);
  const derived = row.kind === "IMAGE" ? await attempt("strip metadata", row.id, () => strippedCopy(path, mime, Number(row.size)), source) : null;
  if (derived) await driver.writeAsset({ ...asset, kind: "derived" }, derived);
  const size = Number(row.size);
  const preview = row.kind === "IMAGE" && wantsPreview(mime, size) ? await attempt("preview", row.id, () => imagePreview(path), source) : null;
  // Not smaller than the original (an already small or well-compressed file): show the original.
  const keepPreview = preview !== null && preview.length < size;
  if (keepPreview) await driver.writeAsset({ ...asset, kind: "preview" }, preview);
  const takenAt = await attempt("date taken", row.id, () => dateTaken(path, row.kind as "IMAGE" | "VIDEO"), source);

  // The file may have been deleted while it was processed; then its assets go too.
  const current = await findNodeForJob(db(), row.id);
  if (!current || current.sha256 !== row.sha256) {
    if (!current) await driver.removeAssets(row.accountId, [row.id]);
    return null;
  }
  const result = { thumb: thumb !== null, derived: derived !== null, preview: keepPreview };
  // An image that should have been cleaned but was not (undecodable, too large) is not tried
  // again for every visitor: share routes answer 415 for it until the file changes. Storage
  // failures never get here (attempt throws them), so they leave the image "not ready" (503).
  const stripFailed = row.kind === "IMAGE" && !result.derived && canStripType(mime);
  // A date taken that could not be read this time keeps any value read before.
  await updateNode(db(), row.id, { hasThumb: result.thumb, hasDerived: result.derived, stripFailed, ...(takenAt ? { takenAt } : {}) });
  return result;
}

/**
 * Reads only the date taken of a photo or video (existing files after the release that added it;
 * thumbnails are left alone). Returns whether a date was found.
 */
export async function recordDateTaken(nodeId: string): Promise<boolean> {
  const row = await findNodeForJob(db(), nodeId);
  if (!row || row.type !== "FILE" || (row.kind !== "IMAGE" && row.kind !== "VIDEO")) return false;
  const account = await findAccountById(db(), row.accountId);
  if (!account) return false;
  const driver = await driverForAccount(account);
  const path = await driver.localPath(await locationOf(row.accountId, row.id));
  if (!path) throw new Error("Media processing needs a local volume.");
  const takenAt = await attempt("date taken", row.id, () => dateTaken(path, row.kind as "IMAGE" | "VIDEO"), { path, volumeId: account.volumeId });
  if (takenAt) await setFileFacts(db(), row.id, { takenAt });
  return takenAt !== null;
}

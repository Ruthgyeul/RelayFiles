import "server-only";
import { access, constants, readFile } from "node:fs/promises";
import sharp from "sharp";
import { MEDIA } from "@/config/policy";
import { LOSSLESS_STRIP_TYPES, stripImageMetadata, type StripMode } from "@/domain/image-metadata";
import { canStripVideo } from "@/domain/video-metadata";
import { db } from "../db/client";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob, setFileFacts, updateNode } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import { driverForAccount } from "../services/volume.service";
import { locationOf } from "../services/node-location";
import { checkVolume } from "../storage/volume";
import { dateTaken } from "./date-taken";
import { shareStripMode, storedStripMode } from "./strip-mode";
import { writeVideoStrippedCopy } from "./video-strip";
import { isTransientMediaError } from "./failure";
import { imagePreview, imageThumbnail, videoThumbnail, wantsPreview } from "./thumbnail";

/** Image types sharp can rewrite in the same format (metadata is dropped on output). */
const REENCODE: Readonly<Record<string, "gif" | "avif" | "tiff">> = { "image/gif": "gif", "image/avif": "avif", "image/tiff": "tiff" };

/** Whether a photo or video of this type can get a shared copy without its metadata. */
export const canStripType = (mime: string, kind: "IMAGE" | "VIDEO" = "IMAGE") => (kind === "VIDEO" ? canStripVideo(mime) : LOSSLESS_STRIP_TYPES.has(mime) || Object.hasOwn(REENCODE, mime));

/**
 * Copy of an image without location and identifying data, in the original format, and the mode
 * it was made in: lossless segment removal or rewrite for JPEG/PNG/WebP, a same-format rewrite
 * for GIF/AVIF/TIFF (which keeps nothing, so it always counts as "all"). Null when the type
 * cannot be cleaned (the share page then does not serve the image publicly as is).
 */
export async function strippedCopy(path: string, mime: string, size: number, mode: StripMode): Promise<{ bytes: Uint8Array; mode: StripMode } | null> {
  if (size > MEDIA.maxStripBytes) return null;
  if (LOSSLESS_STRIP_TYPES.has(mime)) {
    const bytes = stripImageMetadata(await readFile(path), mime, mode);
    return bytes ? { bytes, mode } : null;
  }
  const format = REENCODE[mime];
  if (!format) return null;
  return { bytes: await sharp(path, { animated: format === "gif", limitInputPixels: MEDIA.maxInputPixels }).toFormat(format).toBuffer(), mode: "all" };
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
 * Builds the thumbnail and the metadata-stripped copy for share links (images and videos, in
 * the SHARE_METADATA_STRIP mode; none with "none") of a file. Idempotent: reruns overwrite the
 * assets. Returns null when there is nothing to do.
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
  const size = Number(row.size);
  const stripMode = shareStripMode();
  let derivedMode: StripMode | null = null;
  if (stripMode !== "none" && row.kind === "IMAGE") {
    const copy = await attempt("strip metadata", row.id, () => strippedCopy(path, mime, size, stripMode), source);
    if (copy) {
      await driver.writeAsset({ ...asset, kind: "derived" }, copy.bytes);
      derivedMode = copy.mode;
    }
  } else if (stripMode !== "none" && row.kind === "VIDEO") {
    const made = await attempt("strip video metadata", row.id, () => writeVideoStrippedCopy(driver, asset, { path, mime, size, volumeId: account.volumeId }, stripMode), source);
    if (made) derivedMode = stripMode;
  }
  const derived = derivedMode !== null;
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
  const result = { thumb: thumb !== null, derived, preview: keepPreview };
  // A photo or video that should have been cleaned but was not (undecodable, too large, a
  // container that cannot be copied) is not tried again for every visitor: share routes answer
  // 415 for it until the file changes. Storage failures never get here (attempt throws them),
  // so they leave it "not ready" (503). With SHARE_METADATA_STRIP=none nothing is due.
  const stripFailed = stripMode !== "none" && !derived && (row.kind === "VIDEO" || canStripType(mime));
  // A date taken that could not be read this time keeps any value read before.
  await updateNode(db(), row.id, {
    hasThumb: result.thumb,
    hasDerived: derived,
    derivedMode: derivedMode ? storedStripMode(derivedMode) : null,
    stripFailed,
    ...(takenAt ? { takenAt } : {}),
  });
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

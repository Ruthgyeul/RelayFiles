import "server-only";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { MEDIA } from "@/config/policy";
import { LOSSLESS_STRIP_TYPES, stripImageMetadata } from "@/domain/image-metadata";
import { db } from "../db/client";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob, updateNode } from "../repositories/node.repo";
import { driverForAccount } from "../services/volume.service";
import { locationOf } from "../services/node-location";
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

/** Runs one step; a file that cannot be decoded is logged and skipped, not retried. */
async function attempt<T>(step: string, nodeId: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
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

  const thumb = await attempt("thumbnail", row.id, () => (row.kind === "VIDEO" ? videoThumbnail(path) : imageThumbnail(path)));
  if (thumb) await driver.writeAsset({ ...asset, kind: "thumb" }, thumb);
  const derived = row.kind === "IMAGE" ? await attempt("strip metadata", row.id, () => strippedCopy(path, mime, Number(row.size))) : null;
  if (derived) await driver.writeAsset({ ...asset, kind: "derived" }, derived);
  const size = Number(row.size);
  const preview = row.kind === "IMAGE" && wantsPreview(mime, size) ? await attempt("preview", row.id, () => imagePreview(path)) : null;
  // Not smaller than the original (an already small or well-compressed file): show the original.
  const keepPreview = preview !== null && preview.length < size;
  if (keepPreview) await driver.writeAsset({ ...asset, kind: "preview" }, preview);

  // The file may have been deleted while it was processed; then its assets go too.
  const current = await findNodeForJob(db(), row.id);
  if (!current || current.sha256 !== row.sha256) {
    if (!current) await driver.removeAssets(row.accountId, [row.id]);
    return null;
  }
  const result = { thumb: thumb !== null, derived: derived !== null, preview: keepPreview };
  // An image that should have been cleaned but was not (undecodable, too large) is not tried
  // again for every visitor: share routes answer 415 for it until the file changes.
  const stripFailed = row.kind === "IMAGE" && !result.derived && canStripType(mime);
  await updateNode(db(), row.id, { hasThumb: result.thumb, hasDerived: result.derived, stripFailed });
  return result;
}

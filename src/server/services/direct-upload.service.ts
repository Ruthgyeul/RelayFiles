import "server-only";
import { randomUUID } from "node:crypto";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { getEnv } from "@/config/env";
import type { DuplicatePolicy, UploadedFile } from "@/contracts/uploads";
import { nameError } from "@/domain/names";
import { BYTES_PER_GB } from "@/domain/quota";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { findChildByName } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import type { UploadBatch } from "../upload/batches";
import { assertItemRoom } from "./item-limit.service";
import { requireFolder, type NodeOwner } from "./node-access";
import { releaseSpace, reserveSpace, spaceOf } from "./space.service";
import { finalizeUpload } from "./upload.service";
import { assertAccountWritable } from "./volume.service";

/** Fails as soon as more than `limit` bytes arrive (the client promised `limit` in Content-Length). */
class ByteLimit extends Transform {
  private received = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.received += chunk.length;
    done(this.received > this.limit ? new ApiError("BAD_REQUEST", "The body is longer than its Content-Length.") : null, chunk);
  }
}

/**
 * Stores one file sent as a whole request body (API v1 `POST /api/v1/files`, for clients
 * without tus such as ShareX or curl). The same rules as a tus upload apply: a valid name,
 * the item limit, a space reservation against the quota and the volume, and the recording,
 * hashing and media queue of `finalizeUpload`. A taken name is kept as "name (2)", or with
 * `dup: "replace"` (WebDAV PUT) the file of that name is replaced and kept as a version.
 */
export async function uploadWholeFile(owner: NodeOwner, folderRef: string, requested: string, size: number, body: ReadableStream<Uint8Array>, dup: Exclude<DuplicatePolicy, "skip"> = "keep"): Promise<UploadedFile> {
  const name = requested.trim();
  const problem = nameError(name);
  if (problem) throw new ApiError("BAD_REQUEST", problem, { fields: { name: problem } });
  const maxGb = getEnv("uploads").UPLOAD_MAX_FILE_SIZE_GB;
  if (maxGb !== undefined && size > maxGb * BYTES_PER_GB) throw new ApiError("BAD_REQUEST", `Files can be at most ${maxGb} GB.`);
  await assertAccountWritable(owner.id);
  const folder = await requireFolder(owner.id, folderRef);
  // A replacement adds no item (placeUpload checks again once the bytes are in).
  const replaces = dup === "replace" && (await findChildByName(db(), folder.id, name))?.type === "FILE";
  if (!replaces) await assertItemRoom(owner, 1);
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");

  const uploadId = `api-${randomUUID()}`;
  const space = spaceOf(volume);
  await reserveSpace(owner, uploadId, size, space);
  try {
    await space.driver.stageUpload(uploadId, Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), [new ByteLimit(size)]);
    const batch: UploadBatch = { accountId: owner.id, volumeId: volume.id, folderId: folder.id, fromHome: false, dup, files: [{ rel: name, size }] };
    // finalizeUpload refuses (and removes) a body shorter than promised.
    return await finalizeUpload(owner, batch, 0, uploadId);
  } catch (error) {
    await space.driver.discardUpload(uploadId);
    throw error;
  } finally {
    await releaseSpace(uploadId, owner.id, volume.id).catch((error: unknown) => logger.warn("upload reservation not released", { error }));
  }
}

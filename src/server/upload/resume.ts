import "server-only";
import type { ResumedUpload, ResumeUploadInput } from "@/contracts/uploads";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { findVolume } from "../repositories/volume.repo";
import { reserveSpace, type SpaceOwner } from "../services/space.service";
import { assertAccountWritable } from "../services/volume.service";
import { driverFor } from "../storage/registry";
import { loadBatch, reboundSlot, rebindUpload, setUploadOwner, uploadOwner, uploadRequest } from "./batches";
import { storedUpload } from "./tus";

const fileNameOf = (rel: string) => rel.split("/").at(-1) ?? rel;

/**
 * Lets file `slot` of a new batch continue an unfinished upload of the same account (the
 * page was reloaded and the same file picked again), so its bytes are not sent twice.
 *
 * Anything that does not fit answers 404 and the client starts that file over: an upload of
 * another account or of an upload-only link, one that finished or expired, one of another
 * size or file name, or one another file of the batch already took. The upload keeps its
 * id, so its space reservation is renewed in place (not counted twice) and the tus finish
 * step places it as the new batch's file (its folder and duplicate policy).
 */
export async function resumeUpload(owner: SpaceOwner, input: ResumeUploadInput): Promise<ResumedUpload> {
  const { batchId, slot, uploadId } = input;
  const batch = await loadBatch(batchId);
  const entry = batch?.files[slot];
  if (!batch || !entry || batch.accountId !== owner.id || batch.requestId) throw new ApiError("NOT_FOUND");
  const [accountId, requestId, rebound] = await Promise.all([uploadOwner(uploadId), uploadRequest(uploadId), reboundSlot(uploadId)]);
  if (accountId !== owner.id || requestId) throw new ApiError("NOT_FOUND");
  if (rebound?.batchId === batchId && rebound.slot !== slot) throw new ApiError("NOT_FOUND");

  await assertAccountWritable(owner.id);
  const volume = await findVolume(db(), batch.volumeId);
  if (!volume || volume.status === "OFFLINE") throw new ApiError("STORAGE_OFFLINE");
  const stored = await storedUpload(volume, uploadId);
  if (!stored || stored.size !== entry.size || stored.offset >= stored.size || stored.fileName !== fileNameOf(entry.rel)) throw new ApiError("NOT_FOUND");

  await reserveSpace(owner, uploadId, entry.size, { id: volume.id, reservePct: volume.reservePct, driver: driverFor(volume) });
  await setUploadOwner(uploadId, owner.id);
  await rebindUpload(uploadId, { batchId, slot });
  return { offset: stored.offset };
}

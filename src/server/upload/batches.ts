import "server-only";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { DUPLICATE_POLICIES } from "@/contracts/uploads";
import { redis } from "../redis";

/**
 * An upload batch prepared by POST /api/uploads and consumed by the tus server. It lives in
 * Redis for as long as unfinished chunks are kept (UPLOAD_TMP_TTL_HOURS).
 */
const batchSchema = z.object({
  accountId: z.string(),
  /** True for Home uploads (the folder was created for this upload). */
  fromHome: z.boolean(),
  volumeId: z.string(),
  folderId: z.string(),
  dup: z.enum(DUPLICATE_POLICIES),
  files: z.array(z.object({ rel: z.string(), size: z.number() })),
  /** Set for a visitor upload through an upload-only link (the account is the link's owner). */
  requestId: z.string().optional(),
});

export type UploadBatch = z.infer<typeof batchSchema>;

const HOUR_SECONDS = 3_600;
const ttl = () => getEnv("uploads").UPLOAD_TMP_TTL_HOURS * HOUR_SECONDS;
const batchKey = (batchId: string) => `upload:batch:${batchId}`;
const ownerKey = (uploadId: string) => `upload:owner:${uploadId}`;
const requestKey = (uploadId: string) => `upload:request:${uploadId}`;
const slotKey = (uploadId: string) => `upload:slot:${uploadId}`;
const slotSchema = z.object({ batchId: z.string(), slot: z.number().int().nonnegative() });

/** Where a tus upload's file goes: its batch and position in it. */
export type UploadSlot = z.infer<typeof slotSchema>;

export async function saveBatch(batchId: string, batch: UploadBatch): Promise<void> {
  await redis().set(batchKey(batchId), JSON.stringify(batch), "EX", ttl());
}

export async function loadBatch(batchId: string): Promise<UploadBatch | null> {
  const raw = await redis().get(batchKey(batchId));
  if (!raw) return null;
  const parsed = batchSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Remembers which account owns a tus upload so only it can continue or query it. */
export async function setUploadOwner(uploadId: string, accountId: string): Promise<void> {
  await redis().set(ownerKey(uploadId), accountId, "EX", ttl());
}

export async function uploadOwner(uploadId: string): Promise<string | null> {
  return redis().get(ownerKey(uploadId));
}

/** Remembers that a tus upload comes from a visitor of an upload-only link (no signed-in owner on that device). */
export async function setUploadRequest(uploadId: string, requestId: string): Promise<void> {
  await redis().set(requestKey(uploadId), requestId, "EX", ttl());
}

export async function uploadRequest(uploadId: string): Promise<string | null> {
  return redis().get(requestKey(uploadId));
}

/**
 * Hands an unfinished upload to a newer batch (resuming after a reload): its tus metadata
 * still names the batch it was created for, so the finishing step reads this first.
 */
export async function rebindUpload(uploadId: string, slot: UploadSlot): Promise<void> {
  await redis().set(slotKey(uploadId), JSON.stringify(slot), "EX", ttl());
}

/** The batch slot an upload was handed to by {@link rebindUpload}, if any. */
export async function reboundSlot(uploadId: string): Promise<UploadSlot | null> {
  const raw = await redis().get(slotKey(uploadId));
  if (!raw) return null;
  const parsed = slotSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function forgetUpload(uploadId: string): Promise<void> {
  await redis().del(ownerKey(uploadId), requestKey(uploadId), slotKey(uploadId));
}

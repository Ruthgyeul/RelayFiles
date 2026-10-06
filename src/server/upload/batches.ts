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
});

export type UploadBatch = z.infer<typeof batchSchema>;

const HOUR_SECONDS = 3_600;
const ttl = () => getEnv("uploads").UPLOAD_TMP_TTL_HOURS * HOUR_SECONDS;
const batchKey = (batchId: string) => `upload:batch:${batchId}`;
const ownerKey = (uploadId: string) => `upload:owner:${uploadId}`;

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

export async function forgetUpload(uploadId: string): Promise<void> {
  await redis().del(ownerKey(uploadId));
}

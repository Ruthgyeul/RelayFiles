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
  /** Set when a personal API token prepared the batch (API v1): its files are sent with that token, not a session. */
  apiTokenId: z.string().optional(),
});

export type UploadBatch = z.infer<typeof batchSchema>;

const HOUR_SECONDS = 3_600;
const ttl = () => getEnv("uploads").UPLOAD_TMP_TTL_HOURS * HOUR_SECONDS;
const batchKey = (batchId: string) => `upload:batch:${batchId}`;
const ownerKey = (uploadId: string) => `upload:owner:${uploadId}`;
const requestKey = (uploadId: string) => `upload:request:${uploadId}`;
const slotKey = (uploadId: string) => `upload:slot:${uploadId}`;
const tokenKey = (uploadId: string) => `upload:token:${uploadId}`;
const claimKey = (slot: UploadSlot) => `upload:claim:${slotName(slot)}`;
const claimOfKey = (uploadId: string) => `upload:claimof:${uploadId}`;
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

/** Records the API token an upload was started with: only that token may continue it. */
export async function setUploadToken(uploadId: string, apiTokenId: string): Promise<void> {
  await redis().set(tokenKey(uploadId), apiTokenId, "EX", ttl());
}

export async function uploadToken(uploadId: string): Promise<string | null> {
  return redis().get(tokenKey(uploadId));
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
  await redis().del(ownerKey(uploadId), requestKey(uploadId), slotKey(uploadId), tokenKey(uploadId));
}

/** Value of a slot claim once its file is being placed: no later upload may take the slot. */
const PLACED = "placed:";

/**
 * Takes a slot: refused (0) once a file was placed for it, else set to this upload; returns
 * the upload that held it before (a retry of a create whose answer was lost), or "".
 */
const CLAIM_SCRIPT = `
local held = redis.call("GET", KEYS[1])
if held and string.sub(held, 1, ${PLACED.length}) == "${PLACED}" then return {0, held} end
if held and held ~= ARGV[1] and ARGV[3] == "0" then return {0, held} end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[4], "EX", ARGV[2])
if held and held ~= ARGV[1] then return {1, held} end
return {1, ""}`;

/** Marks the slot as placed while `uploadId` still holds it (1), else 0. */
const PLACE_SCRIPT = `
local slot = redis.call("GET", KEYS[1])
if not slot then return 0 end
local key = ARGV[2] .. slot
if redis.call("GET", key) ~= ARGV[1] then return 0 end
redis.call("SET", key, "${PLACED}" .. ARGV[1], "KEEPTTL")
return 1`;

/** Frees the slot `uploadId` holds (taken or being placed by it); a newer holder is left alone. */
const RELEASE_SCRIPT = `
local slot = redis.call("GET", KEYS[1])
if slot then
  local key = ARGV[2] .. slot
  local held = redis.call("GET", key)
  if held == ARGV[1] or held == "${PLACED}" .. ARGV[1] then redis.call("DEL", key) end
end
redis.call("DEL", KEYS[1])
return 1`;

/** Where slot claims live, below REDIS_KEY_PREFIX (scripts build the key from the stored slot). */
const claimPrefix = () => `${redis().options.keyPrefix ?? ""}upload:claim:`;
const slotName = (slot: UploadSlot) => `${slot.batchId}:${slot.slot}`;

export type SlotClaim = { ok: true; previous: string | null } | { ok: false };

/**
 * Takes batch slot `slot` for `uploadId`. Each file of a batch is one slot, and a slot
 * places one file: tus would otherwise accept any number of uploads for it while the batch
 * lives (0-byte ones finish with their POST and use no quota). A slot whose file is being or
 * was placed refuses every later upload.
 *
 * With `takeOver`, a new upload replaces one that holds the slot but has not finished (its
 * create answer may have been lost to a dropped connection, so the client starts again);
 * the caller then discards that `previous` upload. Without it (resuming), a held slot is refused.
 */
export async function claimSlot(slot: UploadSlot, uploadId: string, { takeOver }: { takeOver: boolean }): Promise<SlotClaim> {
  const [ok, held] = (await redis().eval(CLAIM_SCRIPT, 2, claimKey(slot), claimOfKey(uploadId), uploadId, ttl(), takeOver ? "1" : "0", slotName(slot))) as [number, string];
  if (ok !== 1) return { ok: false };
  return { ok: true, previous: held || null };
}

/**
 * Starts placing `uploadId`'s file: true while the upload still holds its slot, which then
 * stays taken until the batch expires. False when a newer upload took the slot over.
 */
export async function beginPlacing(uploadId: string): Promise<boolean> {
  return Number(await redis().eval(PLACE_SCRIPT, 1, claimOfKey(uploadId), uploadId, claimPrefix())) === 1;
}

/** Frees the slot `uploadId` holds (cancelled, refused or failed upload), so the file can be sent again. */
export async function releaseSlot(uploadId: string): Promise<void> {
  await redis().eval(RELEASE_SCRIPT, 1, claimOfKey(uploadId), uploadId, claimPrefix());
}

/** A placed upload: its slot stays taken, only the lookup from the upload to its slot goes. */
export async function settleSlot(uploadId: string): Promise<void> {
  await redis().del(claimOfKey(uploadId));
}

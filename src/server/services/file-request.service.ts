import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { getAppEnv, getEnv } from "@/config/env";
import { FILE_REQUEST, MS, SHARE } from "@/config/policy";
import type { CreateFileRequestInput, FileRequestDto, FileRequestView, RequestUploadInput, RequestUploadPlan } from "@/contracts/file-requests";
import { isExpired } from "@/domain/account";
import { fileRequestStatus, requestBatchError, requestRoom, type FileRequestStatus } from "@/domain/file-request";
import { formatSize } from "@/domain/format";
import { newFileRequestId, randomString, ID_ALPHABET } from "@/domain/ids";
import { nameError } from "@/domain/names";
import { BYTES_PER_GB, BYTES_PER_MB } from "@/domain/quota";
import type { ClientInfo } from "../auth/client-info";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { countInWindow, redis } from "../redis";
import type { AccountRow } from "../repositories/account.repo";
import { countFileRequests, createFileRequestRow, deleteFileRequest, findFileRequest, listFileRequestRows, type FileRequestRow } from "../repositories/file-request.repo";
import { findVolume } from "../repositories/volume.repo";
import { addUnlock, isUnlocked, type Unlocks } from "../share/unlock-cookie";
import { currentUnlocks } from "../share/viewer";
import { driverFor } from "../storage/registry";
import { saveBatch } from "../upload/batches";
import { assertItemRoom } from "./item-limit.service";
import { requireFolder } from "./node-ops.service";
import { assertSpace } from "./space.service";
import { assertAccountWritable } from "./volume.service";

/** Same length as an upload batch of the web app. */
const BATCH_ID_LENGTH = 24;
const HOUR_SEC = MS.hour / MS.second;

export const fileRequestUrl = (id: string) => `${getAppEnv().PUBLIC_URL}/r/${id}`;
/** Its entry in the share unlock cookie (`rf_sh`), apart from share link ids. */
export const requestUnlockKey = (id: string) => `req:${id}`;

type RequestFields = Pick<FileRequestRow, "expiresAt" | "maxFiles" | "maxBytes" | "filesReceived" | "bytesReceived">;
const limitsOf = (row: RequestFields) => ({ ...row, expiresAt: row.expiresAt?.getTime() ?? null });

export function requestStatus(row: RequestFields & { account: Pick<AccountRow, "isAdmin" | "neverExpire" | "createdAt" | "expiresAt"> }, now: number): FileRequestStatus {
  return fileRequestStatus(limitsOf(row), isExpired(row.account, getEnv("policy").ACCOUNT_TTL_DAYS, new Date(now)), now);
}

function toDto(row: Omit<FileRequestRow, "account">, status: FileRequestStatus): FileRequestDto {
  return {
    id: row.id,
    url: fileRequestUrl(row.id),
    title: row.title,
    folderId: row.folderId,
    hasPassword: row.passwordHash !== null,
    status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxFiles: row.maxFiles,
    maxBytes: row.maxBytes?.toString() ?? null,
    filesReceived: row.filesReceived,
    bytesReceived: row.bytesReceived.toString(),
  };
}

/** The account's upload-only links to one folder. */
export async function listFileRequests(owner: AccountRow, folderRef: string, now: number = Date.now()): Promise<FileRequestDto[]> {
  const folder = await requireFolder(owner.id, folderRef);
  return (await listFileRequestRows(db(), owner.id, folder.id)).map((row) => toDto(row, requestStatus({ ...row, account: owner }, now)));
}

export async function createFileRequest(owner: AccountRow, input: CreateFileRequestInput, now: number = Date.now()): Promise<FileRequestDto> {
  const folder = await requireFolder(owner.id, input.folderId);
  if ((await countFileRequests(db(), owner.id)) >= FILE_REQUEST.maxPerAccount) {
    throw new ApiError("BAD_REQUEST", `An account can hold at most ${FILE_REQUEST.maxPerAccount} upload links. Delete one first.`);
  }
  const passwordHash = input.password === null ? null : await hash(input.password);
  const row = await retryOnUniqueViolation(() =>
    createFileRequestRow(db(), {
      id: newFileRequestId(),
      accountId: owner.id,
      folderId: folder.id,
      title: input.title,
      passwordHash,
      expiresAt: input.expiresInDays === null ? null : new Date(now + input.expiresInDays * MS.day),
      maxFiles: input.maxFiles,
      maxBytes: input.maxMb === null ? null : BigInt(input.maxMb) * BigInt(BYTES_PER_MB),
    }),
  );
  return toDto(row, requestStatus({ ...row, account: owner }, now));
}

export async function removeFileRequest(accountId: string, id: string): Promise<void> {
  if (!(await deleteFileRequest(db(), accountId, id))) throw new ApiError("NOT_FOUND");
}

/** A request a visitor may use: its row, state, and whether this device entered its password. */
export async function visitRequest(id: string, unlocks: Unlocks, now: number) {
  const row = await findFileRequest(db(), id);
  if (!row) throw new ApiError("NOT_FOUND");
  const unlocked = row.passwordHash === null || isUnlocked(unlocks, requestUnlockKey(id), row.passwordHash, cookieSecrets());
  return { row, status: requestStatus(row, now), unlocked };
}

/** The /r/<id> page: what the link is for and how much it still takes, never the folder. */
export async function requestView(id: string, unlocks: Unlocks, now: number): Promise<FileRequestView> {
  const { row, status, unlocked } = await visitRequest(id, unlocks, now);
  const room = requestRoom(limitsOf(row));
  const maxGb = getEnv("uploads").UPLOAD_MAX_FILE_SIZE_GB;
  return {
    id,
    status: status === "open" && !unlocked ? "locked" : status,
    title: row.title,
    ownerName: row.account.name,
    filesLeft: room.files,
    bytesLeft: room.bytes?.toString() ?? null,
    maxFileBytes: maxGb === undefined ? null : String(Math.round(maxGb * BYTES_PER_GB)),
  };
}

/** Checks the request's password; wrong guesses are limited per request and address like share links. */
export async function unlockRequest(id: string, password: string, unlocks: Unlocks, client: ClientInfo, now: number): Promise<string> {
  const { row, unlocked } = await visitRequest(id, unlocks, now);
  const secret = cookieSecrets()[0]!;
  if (unlocked) return addUnlock(unlocks, requestUnlockKey(id), row.passwordHash, secret, now);
  const key = `unlock:${requestUnlockKey(id)}:${client.ipKey}`;
  if ((await countInWindow(key, SHARE.unlockWindowSec)) > SHARE.unlockMaxAttempts) {
    throw new ApiError("RATE_LIMITED", "Too many wrong passwords. Try again later.", { retryAfter: Math.max(1, await redis().ttl(key)) });
  }
  if (!(await verify(row.passwordHash!, password))) throw new ApiError("FORBIDDEN", "Wrong password");
  // Only this attempt is given back (like share links and sign-in), not earlier wrong guesses.
  await redis().decr(key);
  return addUnlock(unlocks, requestUnlockKey(id), row.passwordHash, secret, now);
}

/** Refuses a request that does not take uploads now (gone, expired, full, or still locked). */
export function assertAccepting(status: FileRequestStatus, unlocked: boolean): void {
  if (status === "expired") throw new ApiError("GONE", "This link has expired.");
  if (status === "full") throw new ApiError("GONE", "This link doesn't take more files.");
  if (!unlocked) throw new ApiError("UNAUTHORIZED", "Enter the password first.");
}

/**
 * Plans a visitor upload into the request's folder: names only (no folders), kept as
 * "name (2)" next to existing files, within the request's limits, the item limit and the
 * owner's quota. Space is reserved per file when tus starts it (upload/request-uploads.ts).
 */
export async function prepareRequestUpload(id: string, input: RequestUploadInput, unlocks: Unlocks, client: ClientInfo, now: number): Promise<RequestUploadPlan> {
  const { row, status, unlocked } = await visitRequest(id, unlocks, now);
  assertAccepting(status, unlocked);
  for (const file of input.files) {
    const problem = nameError(file.name);
    if (problem) throw new ApiError("BAD_REQUEST", problem, { fields: { files: problem } });
  }
  if ((await countInWindow(`request:batch:${id}:${client.ipKey}`, HOUR_SEC)) > FILE_REQUEST.batchesPerHour) {
    throw new ApiError("RATE_LIMITED", "Too many uploads from this address. Try again later.", { retryAfter: HOUR_SEC });
  }
  const tooMuch = requestBatchError(requestRoom(limitsOf(row)), input.files, formatSize);
  if (tooMuch) throw new ApiError("BAD_REQUEST", tooMuch);

  const owner = row.account;
  await assertAccountWritable(owner.id);
  const folder = await requireFolder(owner.id, row.folderId);
  await assertItemRoom(owner, input.files.length);
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  await assertSpace(owner, input.files.reduce((sum, file) => sum + file.size, 0), { id: volume.id, reservePct: volume.reservePct, driver: driverFor(volume) });

  const batchId = randomString(BATCH_ID_LENGTH, ID_ALPHABET);
  await saveBatch(batchId, { accountId: owner.id, volumeId: volume.id, folderId: folder.id, fromHome: false, dup: "keep", files: input.files.map((file) => ({ rel: file.name, size: file.size })), requestId: id });
  return { batchId, endpoint: `/api/uploads/tus/${volume.id}` };
}

/** The /r/<id> page for this device (server component), or null for an unknown link. */
export async function requestPageFor(id: string): Promise<FileRequestView | null> {
  const now = Date.now();
  return requestView(id, await currentUnlocks(now), now).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  });
}

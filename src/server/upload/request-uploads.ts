import "server-only";
import { requestRoom } from "@/domain/file-request";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { addReceived, findFileRequest, type FileRequestRow } from "../repositories/file-request.repo";
import { assertAccepting, requestStatus, requestUnlockKey } from "../services/file-request.service";
import { decodeUnlocks, isUnlocked, UNLOCK_COOKIE } from "../share/unlock-cookie";
import { releaseUpload, reservedBytes, reserveUpload, type ReservationScope } from "./reservations";

/**
 * The tus side of upload-only links: who may send a visitor's files, and the request's own
 * limits (files and bytes) reserved per upload the same way as the quota, so parallel
 * uploads cannot together pass "at most N files" or "at most X MB".
 */

const scopesOf = (requestId: string): [ReservationScope, ReservationScope] => [
  { kind: "request-bytes", id: requestId },
  { kind: "request-files", id: requestId },
];

function unlocksOf(req: Request, now: number) {
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${UNLOCK_COOKIE}=`));
  return decodeUnlocks(cookie?.slice(UNLOCK_COOKIE.length + 1), cookieSecrets(), now);
}

/**
 * The request a visitor's tus call belongs to, when it still takes uploads and this device
 * entered its password. Continuing an upload (`starting` false) is allowed on a full request:
 * its room was reserved when it started.
 */
export async function requestFor(req: Request, requestId: string, starting: boolean, now: number = Date.now()): Promise<FileRequestRow> {
  const row = await findFileRequest(db(), requestId);
  if (!row) throw new ApiError("NOT_FOUND");
  const unlocked = row.passwordHash === null || isUnlocked(unlocksOf(req, now), requestUnlockKey(requestId), row.passwordHash, cookieSecrets());
  const status = requestStatus(row, now);
  assertAccepting(!starting && status === "full" ? "open" : status, unlocked);
  return row;
}

/** Reserves one file of `size` bytes against the request's limits, or refuses it. */
export async function reserveRequestRoom(row: FileRequestRow, uploadId: string, size: number): Promise<void> {
  const [bytesScope, filesScope] = scopesOf(row.id);
  const room = requestRoom({ ...row, expiresAt: null });
  const full = await reserveUpload(uploadId, size, [{ scope: bytesScope, limit: room.bytes }]);
  if (full) throw new ApiError("GONE", "This link doesn't take more files.");
  const fullFiles = await reserveUpload(uploadId, 1, [{ scope: filesScope, limit: room.files === null ? null : BigInt(room.files) }]);
  if (fullFiles) {
    await releaseRequestRoom(row.id, uploadId);
    throw new ApiError("GONE", "This link doesn't take more files.");
  }
  // Like reserveSpace: a file that finished in between moved from "reserved" to "received"
  // and neither number saw it. Reservations first, then the counters.
  const [heldBytes, heldFiles] = await Promise.all([reservedBytes(bytesScope), reservedBytes(filesScope)]);
  const fresh = await findFileRequest(db(), row.id);
  const left = fresh ? requestRoom({ ...fresh, expiresAt: null }) : { files: 0, bytes: 0n };
  if ((left.bytes !== null && heldBytes > left.bytes) || (left.files !== null && heldFiles > BigInt(left.files))) {
    await releaseRequestRoom(row.id, uploadId);
    throw new ApiError("GONE", "This link doesn't take more files.");
  }
}

/** Counts a placed file against the request, then drops its reservation. */
export async function recordRequestUpload(requestId: string, uploadId: string, size: number): Promise<void> {
  await addReceived(db(), requestId, BigInt(size));
  await releaseRequestRoom(requestId, uploadId);
}

export async function releaseRequestRoom(requestId: string, uploadId: string): Promise<void> {
  await releaseUpload(uploadId, scopesOf(requestId));
}

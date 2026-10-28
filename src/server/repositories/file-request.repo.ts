import "server-only";
import type { DbClient } from "../db/client";
import { ACCOUNT_SELECT } from "./account.repo";

const REQUEST_SELECT = {
  id: true,
  accountId: true,
  folderId: true,
  title: true,
  passwordHash: true,
  expiresAt: true,
  maxFiles: true,
  maxBytes: true,
  filesReceived: true,
  bytesReceived: true,
  createdAt: true,
} as const;

export interface NewFileRequest {
  id: string;
  accountId: string;
  folderId: string;
  title: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxFiles: number | null;
  maxBytes: bigint | null;
}

export function createFileRequestRow(db: DbClient, data: NewFileRequest) {
  return db.fileRequest.create({ data, select: REQUEST_SELECT });
}

/** The account's requests for one folder, newest first. */
export function listFileRequestRows(db: DbClient, accountId: string, folderId: string) {
  return db.fileRequest.findMany({ where: { accountId, folderId }, orderBy: { createdAt: "desc" }, select: REQUEST_SELECT });
}

export function countFileRequests(db: DbClient, accountId: string): Promise<number> {
  return db.fileRequest.count({ where: { accountId } });
}

/** Deletes one of the account's requests; false when it has no such request. */
export async function deleteFileRequest(db: DbClient, accountId: string, id: string): Promise<boolean> {
  return (await db.fileRequest.deleteMany({ where: { id, accountId } })).count === 1;
}

/** A request by its public id, with the owning account (for visitors and the tus server). */
export function findFileRequest(db: DbClient, id: string) {
  return db.fileRequest.findUnique({ where: { id }, select: { ...REQUEST_SELECT, account: { select: ACCOUNT_SELECT } } });
}

export type FileRequestRow = NonNullable<Awaited<ReturnType<typeof findFileRequest>>>;

/** Counts a file that arrived through the request. */
export async function addReceived(db: DbClient, id: string, bytes: bigint): Promise<void> {
  await db.fileRequest.updateMany({ where: { id }, data: { filesReceived: { increment: 1 }, bytesReceived: { increment: bytes } } });
}

/** Daily cleanup: requests that expired before `before` (their files stay in the folder). */
export async function deleteExpiredFileRequests(db: DbClient, before: Date): Promise<number> {
  return (await db.fileRequest.deleteMany({ where: { expiresAt: { lte: before } } })).count;
}

import "server-only";
import type { DbClient } from "../db/client";

export interface NewFileVersion {
  id: string;
  nodeId: string;
  accountId: string;
  size: bigint;
  sha256: string | null;
  mime: string | null;
  modifiedAt: Date | null;
  createdAt?: Date;
}

const VERSION_SELECT = { id: true, nodeId: true, accountId: true, size: true, sha256: true, mime: true, modifiedAt: true, createdAt: true } as const;

export async function createFileVersion(db: DbClient, version: NewFileVersion): Promise<void> {
  await db.fileVersion.create({ data: version });
}

/** Earlier versions follow their file to the row that replaced it (a replacement gets a new node id). */
export async function moveVersionsToNode(db: DbClient, fromNodeId: string, toNodeId: string): Promise<void> {
  await db.fileVersion.updateMany({ where: { nodeId: fromNodeId }, data: { nodeId: toNodeId } });
}

/** A file's earlier versions, newest first. */
export function listFileVersions(db: DbClient, accountId: string, nodeId: string) {
  return db.fileVersion.findMany({ where: { accountId, nodeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: VERSION_SELECT });
}

export function findFileVersion(db: DbClient, accountId: string, nodeId: string, id: string) {
  return db.fileVersion.findFirst({ where: { id, accountId, nodeId }, select: VERSION_SELECT });
}

/** Deletes one version row; false when it was already gone. */
export async function deleteFileVersion(db: DbClient, accountId: string, id: string): Promise<boolean> {
  return (await db.fileVersion.deleteMany({ where: { id, accountId } })).count === 1;
}

/** Bytes the account's kept versions hold (they count toward its storage). */
export async function accountVersionBytes(db: DbClient, accountId: string): Promise<bigint> {
  const sum = await db.fileVersion.aggregate({ where: { accountId }, _sum: { size: true } });
  return sum._sum.size ?? 0n;
}

/** Versions made before `before`, oldest first, with the volume their account is on. */
export function expiredFileVersions(db: DbClient, before: Date, limit: number) {
  return db.fileVersion.findMany({
    where: { createdAt: { lt: before } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, accountId: true, account: { select: { volumeId: true } } },
  });
}

export async function deleteFileVersions(db: DbClient, ids: readonly string[]): Promise<number> {
  return (await db.fileVersion.deleteMany({ where: { id: { in: [...ids] } } })).count;
}

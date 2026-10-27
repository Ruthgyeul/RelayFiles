import "server-only";
import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/client";

/** Records the bytes of deleted files an account left in a volume's trash. */
export async function recordTrashed(db: DbClient, accountId: string, bytes: bigint, at: Date = new Date()): Promise<void> {
  if (bytes <= 0n) return;
  await db.trashedBytes.create({ data: { id: randomUUID(), accountId, bytes, trashedAt: at } });
}

/** Bytes an account still holds in the trash. */
export async function accountTrashedBytes(db: DbClient, accountId: string): Promise<bigint> {
  const sum = await db.trashedBytes.aggregate({ where: { accountId }, _sum: { bytes: true } });
  return sum._sum.bytes ?? 0n;
}

/** Bytes all anonymous (non-admin) accounts still hold in the trash, for ANON_TOTAL_QUOTA_GB. */
export async function anonTrashedBytes(db: DbClient): Promise<bigint> {
  const sum = await db.trashedBytes.aggregate({ where: { account: { isAdmin: false } }, _sum: { bytes: true } });
  return sum._sum.bytes ?? 0n;
}

/** Forgets trash moved there before `before` (the daily job has removed it from disk). */
export async function forgetTrashedBefore(db: DbClient, before: Date): Promise<number> {
  return (await db.trashedBytes.deleteMany({ where: { trashedAt: { lt: before } } })).count;
}

import "server-only";
import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/client";

/**
 * Records the bytes of deleted files an account left in a volume's trash: the trash of the
 * volume the account is on now (call it in the transaction that moved them there).
 */
export async function recordTrashed(db: DbClient, accountId: string, bytes: bigint, at: Date = new Date()): Promise<void> {
  if (bytes <= 0n) return;
  const account = await db.account.findUnique({ where: { id: accountId }, select: { volumeId: true } });
  await addTrashedBytes(db, { accountId, volumeId: account?.volumeId ?? null, bytes, at });
}

/**
 * Records the bytes of deleted files waiting in `volumeId`'s trash and returns the row's id, so
 * the item they belong to can take exactly them back (a restore from "Recently deleted").
 * Null when there were no bytes (no row is written).
 */
export async function addTrashedBytes(db: DbClient, entry: { accountId: string; volumeId: string | null; bytes: bigint; at: Date }): Promise<string | null> {
  if (entry.bytes <= 0n) return null;
  const id = randomUUID();
  await db.trashedBytes.create({ data: { id, accountId: entry.accountId, bytes: entry.bytes, volumeId: entry.volumeId, trashedAt: entry.at } });
  return id;
}

/** Forgets one TrashedBytes row of an account (its files left the trash: restored or removed for good). */
export async function removeTrashedBytes(db: DbClient, accountId: string, id: string): Promise<void> {
  await db.trashedBytes.deleteMany({ where: { id, accountId } });
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

/**
 * Forgets trash moved there before `before` on the volumes whose trash the daily job just
 * emptied (`volumeIds`). Bytes in the trash of a volume that was skipped (READONLY, OFFLINE) still
 * take space there and keep counting. Rows from before TrashedBytes.volumeId use the account's volume.
 */
export async function forgetTrashedBefore(db: DbClient, before: Date, volumeIds: readonly string[]): Promise<number> {
  if (volumeIds.length === 0) return 0;
  const ids = [...volumeIds];
  const { count } = await db.trashedBytes.deleteMany({
    where: { trashedAt: { lt: before }, OR: [{ volumeId: { in: ids } }, { volumeId: null, account: { volumeId: { in: ids } } }] },
  });
  return count;
}

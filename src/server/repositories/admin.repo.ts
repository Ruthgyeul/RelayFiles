import "server-only";
import type { DbClient } from "../db/client";

/** Every account with the fields the Accounts page shows. */
export function listAccountsForAdmin(db: DbClient) {
  return db.account.findMany({
    select: { id: true, name: true, isAdmin: true, neverExpire: true, createdAt: true, lastLoginAt: true, expiresAt: true, quotaBytes: true, volumeId: true },
    orderBy: { createdAt: "asc" },
  });
}

/** File count and bytes per account. */
export async function fileTotalsByAccount(db: DbClient): Promise<Map<string, { files: number; bytes: bigint }>> {
  const rows = await db.node.groupBy({ by: ["accountId"], where: { type: "FILE" }, _count: { _all: true }, _sum: { size: true } });
  return new Map(rows.map((row) => [row.accountId, { files: row._count._all, bytes: row._sum.size ?? 0n }]));
}

export function countAdmins(db: DbClient): Promise<number> {
  return db.account.count({ where: { isAdmin: true } });
}

/** Advisory lock key for changes that can remove an admin (any fixed 64-bit number). */
const ADMIN_ROLES_LOCK_KEY = 0x72_66_61_64_6d_69_6e;

/**
 * Serializes, inside a transaction, every change that can take the last admin away (demotion,
 * deleting an admin account): two admins demoting each other at once would otherwise each see
 * the other still counted and leave none.
 */
export async function lockAdminRoles(tx: DbClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_ROLES_LOCK_KEY})`;
}

export async function updateAccountByAdmin(db: DbClient, accountId: string, data: { isAdmin: boolean; neverExpire: boolean; expiresAt: Date | null; quotaBytes: bigint | null }): Promise<void> {
  await db.account.update({ where: { id: accountId }, data });
}

/** Per account: file and folder counts and file bytes (one grouped scan of the tree). */
export async function nodeTotalsByAccount(db: DbClient): Promise<Map<string, { files: number; folders: number; bytes: bigint }>> {
  const rows = await db.node.groupBy({ by: ["accountId", "type"], _count: { _all: true }, _sum: { size: true } });
  const totals = new Map<string, { files: number; folders: number; bytes: bigint }>();
  for (const row of rows) {
    const total = totals.get(row.accountId) ?? { files: 0, folders: 0, bytes: 0n };
    if (row.type === "FILE") {
      total.files = row._count._all;
      total.bytes = row._sum.size ?? 0n;
    } else total.folders = row._count._all;
    totals.set(row.accountId, total);
  }
  return totals;
}

/** Bytes waiting in the trash per account (they still count toward storage). */
export async function trashTotalsByAccount(db: DbClient): Promise<Map<string, bigint>> {
  const rows = await db.trashedBytes.groupBy({ by: ["accountId"], _sum: { bytes: true } });
  return new Map(rows.map((row) => [row.accountId, row._sum.bytes ?? 0n]));
}

/** Share traffic per account over the days `from`..`to` (inclusive, UTC dates). */
export async function trafficTotalsByAccount(db: DbClient, from: Date, to: Date): Promise<Map<string, bigint>> {
  const rows = await db.trafficDaily.groupBy({ by: ["accountId"], where: { day: { gte: from, lte: to } }, _sum: { bytes: true } });
  return new Map(rows.map((row) => [row.accountId, row._sum.bytes ?? 0n]));
}

/** Share traffic of every account per month ("YYYY-MM") over the days `from`..`to`. */
export async function trafficByMonth(db: DbClient, from: Date, to: Date): Promise<Map<string, bigint>> {
  const rows = await db.$queryRaw<{ month: string; bytes: bigint }[]>`
    SELECT to_char(date_trunc('month', "day"), 'YYYY-MM') AS month, SUM("bytes")::bigint AS bytes
    FROM "TrafficDaily" WHERE "day" >= ${from}::date AND "day" <= ${to}::date
    GROUP BY 1 ORDER BY 1`;
  return new Map(rows.map((row) => [row.month, row.bytes]));
}

/** API tokens per account. */
export async function apiTokenCountsByAccount(db: DbClient): Promise<Map<string, number>> {
  const rows = await db.apiToken.groupBy({ by: ["accountId"], _count: { _all: true } });
  return new Map(rows.map((row) => [row.accountId, row._count._all]));
}

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

export async function updateAccountByAdmin(db: DbClient, accountId: string, data: { isAdmin: boolean; neverExpire: boolean; expiresAt: Date | null; quotaBytes: bigint | null }): Promise<void> {
  await db.account.update({ where: { id: accountId }, data });
}

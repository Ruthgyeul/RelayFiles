import "server-only";
import type { DbClient } from "../db/client";
import { NODE_SELECT } from "./node.repo";

// What an account stores: totals for quotas and limits, and the Storage page's lists.

/** Bytes stored by an account (sum of file sizes) and the number of items in its root folder. */
export async function accountUsage(db: DbClient, accountId: string): Promise<{ usedBytes: bigint; rootItems: number }> {
  const [sum, rootItems] = await Promise.all([
    db.node.aggregate({ where: { accountId, type: "FILE" }, _sum: { size: true } }),
    db.node.count({ where: { accountId, parent: { parentId: null, accountId } } }),
  ]);
  return { usedBytes: sum._sum.size ?? 0n, rootItems };
}

/** Items of an account that expire (and lose their link) after `from` and by `until`. */
export function countExpiring(db: DbClient, accountId: string, from: Date, until: Date): Promise<number> {
  return db.node.count({ where: { accountId, expAt: { gt: from, lte: until } } });
}

/** Files and folders of an account, its root folder included. */
export function countItems(db: DbClient, accountId: string): Promise<number> {
  return db.node.count({ where: { accountId } });
}

/** Bytes stored by all anonymous (non-admin) accounts, for ANON_TOTAL_QUOTA_GB. */
export async function anonUsage(db: DbClient): Promise<bigint> {
  const sum = await db.node.aggregate({ where: { type: "FILE", account: { isAdmin: false } }, _sum: { size: true } });
  return sum._sum.size ?? 0n;
}

/** Files and folders of an account (the root folder is not counted). */
export async function contentCounts(db: DbClient, accountId: string): Promise<{ files: number; folders: number }> {
  const rows = await db.node.groupBy({ by: ["type"], where: { accountId, parentId: { not: null } }, _count: { _all: true } });
  const count = (type: "FILE" | "FOLDER") => rows.find((row) => row.type === type)?._count._all ?? 0;
  return { files: count("FILE"), folders: count("FOLDER") };
}

/** Tags used in an account with how many items carry each, most used first (the Tags dialog's suggestions). */
export function tagUsage(db: DbClient, accountId: string, limit: number): Promise<{ tag: string; count: number }[]> {
  return db.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT tag, COUNT(*)::bigint AS count FROM "Node", unnest(tags) AS tag
    WHERE "accountId" = ${accountId} GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ${limit}`.then((rows) => rows.map((row) => ({ tag: row.tag, count: Number(row.count) })));
}

/** The account's largest files (Storage page), largest first. */
export function largestFiles(db: DbClient, accountId: string, limit: number) {
  return db.node.findMany({ where: { accountId, type: "FILE", size: { gt: 0n } }, orderBy: [{ size: "desc" }, { id: "asc" }], select: NODE_SELECT, take: limit });
}

/**
 * Files added before `before` that nobody opened, played or downloaded through a share link
 * since (Storage page "Not opened lately"), largest first. The owner's own downloads are not
 * recorded, so this is about share links only.
 */
export function staleFiles(db: DbClient, accountId: string, before: Date, limit: number) {
  return db.node.findMany({
    where: { accountId, type: "FILE", createdAt: { lt: before }, events: { none: { kind: { in: ["OPEN", "VIEW", "PLAY", "DOWNLOAD"] }, at: { gte: before } } } },
    orderBy: [{ size: "desc" }, { id: "asc" }],
    select: NODE_SELECT,
    take: limit,
  });
}

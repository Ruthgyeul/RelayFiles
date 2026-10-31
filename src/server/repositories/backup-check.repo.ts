import "server-only";
import type { BackupCounts } from "@/domain/backup-check";
import type { DbClient } from "../db/client";

export interface NewBackupCheck {
  ok: boolean;
  dumpName: string | null;
  dumpAt: Date | null;
  restoreMs: number | null;
  fsckDifferences: number | null;
  problems: string[];
}

export async function recordBackupCheck(db: DbClient, check: NewBackupCheck): Promise<void> {
  await db.backupCheck.create({ data: check });
}

export function latestBackupCheck(db: DbClient) {
  return db.backupCheck.findFirst({ orderBy: { checkedAt: "desc" } });
}

/** Keeps the newest `keep` results. */
export async function pruneBackupChecks(db: DbClient, keep: number): Promise<void> {
  const kept = await db.backupCheck.findMany({ orderBy: { checkedAt: "desc" }, take: keep, select: { id: true } });
  await db.backupCheck.deleteMany({ where: { id: { notIn: kept.map((row) => row.id) } } });
}

/** Rows a backup is compared by (on production or on the restored copy). */
export async function backupCounts(db: DbClient): Promise<BackupCounts> {
  const [accounts, nodes, publicLinks] = await Promise.all([db.account.count(), db.node.count(), db.node.count({ where: { visibility: "PUBLIC" } })]);
  return { accounts, nodes, publicLinks };
}

/** Name of the newest finished migration in a database, or null when it has none (an empty restore). */
export async function lastAppliedMigration(db: DbClient): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT migration_name AS name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`;
    return rows[0]?.name ?? null;
  } catch {
    // No migrations table: the restore left the database empty.
    return null;
  }
}

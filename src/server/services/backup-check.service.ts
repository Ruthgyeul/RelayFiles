import "server-only";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP } from "@/config/policy";
import { backupProblems } from "@/domain/backup-check";
import { db, openDatabase } from "../db/client";
import { logger } from "../logger";
import { backupCounts, lastAppliedMigration, pruneBackupChecks, recordBackupCheck, type NewBackupCheck } from "../repositories/backup-check.repo";
import { runFsck, type FsckReport } from "./fsck.service";

/** Where `prisma migrate deploy` reads the migrations this code ships (relative to the app root). */
const MIGRATIONS_DIR = join("prisma", "migrations");

export interface BackupVerifyInput {
  /** The dump that was restored; null when the backup directory had none. */
  dump: { name: string; at: Date } | null;
  /** Connection string of the scratch database the dump was restored into. */
  restoredUrl: string | null;
  restoreMs: number | null;
  /** Set when the shell step failed before anything could be compared (e.g. pg_restore failed). */
  failure?: string;
  /** What `restic check` reported about the offsite repository, when it failed. */
  offsiteFailure?: string;
}

/** Newest migration directory of this code, or null when it ships none. */
async function newestMigration(): Promise<string | null> {
  const entries = await readdir(join(process.cwd(), MIGRATIONS_DIR), { withFileTypes: true });
  return (
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1) ?? null
  );
}

/** Everything storage:fsck found different, counted per item. */
function fsckDifferences(report: FsckReport): number {
  const perAccount = report.accounts.reduce((sum, entry) => sum + entry.missing.length + entry.orphans.length + entry.sizeMismatch.length, 0);
  return perAccount + report.strayAccounts.length;
}

/** The restored copy's schema and counts; a dump that cannot be read is a problem, not a crash. */
async function readRestored(url: string) {
  const restored = openDatabase(url);
  try {
    return { migration: await lastAppliedMigration(restored), counts: await backupCounts(restored) };
  } catch (error) {
    logger.warn("restored backup could not be read", { error });
    return null;
  } finally {
    await restored.$disconnect();
  }
}

async function compare(input: BackupVerifyInput & { dump: { name: string; at: Date }; restoredUrl: string }, now: Date): Promise<NewBackupCheck> {
  const base = { dumpName: input.dump.name, dumpAt: input.dump.at, restoreMs: input.restoreMs };
  const restored = await readRestored(input.restoredUrl);
  if (!restored) return { ...base, ok: false, fsckDifferences: null, problems: ["the restored dump cannot be read"] };
  const [live, expectedMigration, fsck] = await Promise.all([backupCounts(db()), newestMigration(), runFsck({ fix: false })]);
  const differences = fsckDifferences(fsck);
  const problems = backupProblems(
    {
      dumpAt: input.dump.at.getTime(),
      now: now.getTime(),
      restoredMigration: restored.migration,
      expectedMigration,
      restored: restored.counts,
      live,
      fsckDifferences: differences,
      offsiteError: input.offsiteFailure ?? null,
    },
    { maxDumpAgeHours: BACKUP.verifyMaxDumpAgeHours, maxDriftPct: BACKUP.verifyMaxDriftPct },
  );
  return { ...base, ok: problems.length === 0, fsckDifferences: differences, problems };
}

/**
 * Checks a dump restored into a scratch database (deploy/scripts/verify-backup.sh): its age,
 * schema and row counts against production, plus a report-only storage:fsck of the volumes.
 * The result is stored for the Server page ("Backup check") and returned for the log file.
 */
export async function verifyBackup(input: BackupVerifyInput, now: Date = new Date()): Promise<NewBackupCheck> {
  const check: NewBackupCheck =
    input.failure || !input.dump || !input.restoredUrl
      ? {
          ok: false,
          dumpName: input.dump?.name ?? null,
          dumpAt: input.dump?.at ?? null,
          restoreMs: input.restoreMs,
          fsckDifferences: null,
          problems: [input.failure ?? "no database dump found (deploy/scripts/backup.sh)", ...(input.offsiteFailure ? [`offsite backup: ${input.offsiteFailure}`] : [])],
        }
      : await compare({ ...input, dump: input.dump, restoredUrl: input.restoredUrl }, now);
  await recordBackupCheck(db(), check);
  await pruneBackupChecks(db(), BACKUP.checksKept);
  if (!check.ok) logger.error("backup check failed", { dump: check.dumpName, problems: check.problems });
  return check;
}

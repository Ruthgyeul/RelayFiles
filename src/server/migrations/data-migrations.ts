import "server-only";
import { MIGRATION, MS } from "@/config/policy";
import type { DbClient, PrismaClient } from "../db/client";
import { tryRunLock, waitForRunLock } from "../repositories/advisory-lock.repo";

/**
 * Data migrations: backfills and value conversions that run after the SQL migrations
 * (docs/runbook.md "데이터 마이그레이션"). Each one works in batches and saves a cursor, so an interrupted
 * run continues where it stopped. Finished migrations are recorded and never run again.
 */
export interface DataMigrationStep {
  /** Stable id, e.g. "20261101-backfill-sha256". Never rename one that has run. */
  id: string;
  description: string;
  /** Processes the rows after `cursor` and calls `save` after each batch; returns when done. */
  run(context: { db: DbClient; cursor: string | null; save: (cursor: string) => Promise<void> }): Promise<void>;
}

export interface DataMigrationReport {
  ran: string[];
  skipped: string[];
}

/** Name of the lock one run holds (a k3s job and a manual `npm run data:migrate` never overlap). */
const RUN_LOCK = "data-migrations";

/**
 * Runs the pending steps in order. One run at a time: the run holds a PostgreSQL advisory lock
 * (in a transaction kept open for at most MIGRATION.runLockHours; the steps use their own
 * connections), and a second run waits for it, then skips what the first one finished.
 */
export async function runDataMigrations(db: PrismaClient, steps: readonly DataMigrationStep[], log: (message: string) => void = () => undefined): Promise<DataMigrationReport> {
  return db.$transaction(
    async (lock) => {
      if (!(await tryRunLock(lock, RUN_LOCK))) {
        log("Another data:migrate run is in progress; waiting for it to finish.");
        await waitForRunLock(lock, RUN_LOCK);
      }
      return runSteps(db, steps, log);
    },
    { timeout: MIGRATION.runLockHours * MS.hour },
  );
}

async function runSteps(db: DbClient, steps: readonly DataMigrationStep[], log: (message: string) => void): Promise<DataMigrationReport> {
  const report: DataMigrationReport = { ran: [], skipped: [] };
  for (const step of steps) {
    const existing = await db.dataMigration.findUnique({ where: { id: step.id } });
    if (existing?.finishedAt) {
      report.skipped.push(step.id);
      continue;
    }
    if (!existing) await db.dataMigration.create({ data: { id: step.id } });
    log(`${step.id}: ${step.description}${existing?.cursor ? ` (resuming after ${existing.cursor})` : ""}`);
    await step.run({
      db,
      cursor: existing?.cursor ?? null,
      save: async (cursor) => {
        await db.dataMigration.update({ where: { id: step.id }, data: { cursor } });
      },
    });
    await db.dataMigration.update({ where: { id: step.id }, data: { finishedAt: new Date() } });
    report.ran.push(step.id);
  }
  return report;
}

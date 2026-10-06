import "server-only";
import type { DbClient } from "../db/client";

/**
 * Data migrations: backfills and value conversions that run after the SQL migrations
 * (docs/plan.md §13.8 ①). Each one works in batches and saves a cursor, so an interrupted
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

export async function runDataMigrations(db: DbClient, steps: readonly DataMigrationStep[], log: (message: string) => void = () => undefined): Promise<DataMigrationReport> {
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

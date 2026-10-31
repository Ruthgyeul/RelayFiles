import "server-only";
import { MIGRATION } from "@/config/policy";
import { enqueueDateTaken } from "../jobs/queue";
import { mediaWithoutDateTaken } from "../repositories/node.repo";
import type { DataMigrationStep } from "./data-migrations";

/**
 * Photos and videos uploaded before Node.takenAt existed get their date taken read from their
 * metadata. The migration only queues "taken" jobs (one per file, deduplicated); the worker reads
 * them in the background after the release, so maintenance mode does not last longer. Until then
 * "Renumber files" by date taken uses their modification time.
 */
export const queueDateTaken: DataMigrationStep = {
  id: "20261101-queue-date-taken",
  description: "queue reading the date taken of existing photos and videos",
  async run({ db, cursor, save }) {
    let after = cursor;
    for (;;) {
      const rows = await mediaWithoutDateTaken(db, MIGRATION.batchSize, after);
      if (rows.length === 0) break;
      await enqueueDateTaken(rows.map((row) => row.id));
      after = rows.at(-1)!.id;
      await save(after);
    }
  },
};

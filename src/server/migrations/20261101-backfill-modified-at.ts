import "server-only";
import { MIGRATION } from "@/config/policy";
import { logger } from "../logger";
import { filesWithoutModifiedAt, setModifiedTimes } from "../repositories/node.repo";
import type { DataMigrationStep } from "./data-migrations";
import { fileReader } from "./file-backfill";

/**
 * Files uploaded before Node.modifiedAt existed get the time their bytes last changed on the
 * volume (the disk mtime; renames and hard links keep it), so "Renumber files" by date modified
 * works for them too. Files missing on disk get their creation time.
 */
export const backfillModifiedAt: DataMigrationStep = {
  id: "20261101-backfill-modified-at",
  description: "record the disk modification time of existing files",
  async run({ db, cursor, save }) {
    const files = fileReader(db);
    let after = cursor;
    let skipped = 0;
    for (;;) {
      const rows = await filesWithoutModifiedAt(db, MIGRATION.batchSize, after);
      if (rows.length === 0) break;
      const locations = await files.locationsOf(rows.filter((row) => !row.missing));
      const times: { id: string; modifiedAt: Date }[] = [];
      for (const row of rows) {
        const driver = await files.driverOf(row.account.volumeId);
        if (!driver) {
          skipped += 1;
          continue;
        }
        const location = locations.get(row.id);
        const info = location ? await driver.stat(location) : null;
        times.push({ id: row.id, modifiedAt: info?.type === "file" ? info.modifiedAt : row.createdAt });
      }
      await setModifiedTimes(db, times);
      after = rows.at(-1)!.id;
      await save(after);
    }
    if (skipped > 0) logger.warn("modification times not recorded: volume offline", { files: skipped });
  },
};

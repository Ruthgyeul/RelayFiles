import "server-only";
import { MIGRATION } from "@/config/policy";
import { logger } from "../logger";
import { filesWithoutSha256, setFileFacts } from "../repositories/node.repo";
import { sha256Of } from "../storage/hash";
import type { DataMigrationStep } from "./data-migrations";
import { fileReader } from "./file-backfill";

/**
 * Hashes files that have no SHA-256 yet, so "Find duplicates" compares every file. Uploads have
 * always been hashed, so on most servers there is nothing to do. A file missing on disk, or one
 * whose size changed, keeps no hash (it is listed as "not checked"; npm run storage:fsck reports it).
 */
export const backfillSha256: DataMigrationStep = {
  id: "20261101-backfill-sha256",
  description: "hash existing files without a content hash",
  async run({ db, cursor, save }) {
    const files = fileReader(db);
    let after = cursor;
    let unreadable = 0;
    for (;;) {
      const rows = await filesWithoutSha256(db, MIGRATION.batchSize, after);
      if (rows.length === 0) break;
      for (const row of rows) {
        const driver = row.missing ? null : await files.driverOf(row.account.volumeId);
        const location = driver ? await files.locationOf(row.accountId, row.id) : null;
        const info = driver && location ? await driver.stat(location) : null;
        if (!driver || !location || info?.type !== "file" || info.size !== row.size) {
          unreadable += 1;
          continue;
        }
        await setFileFacts(db, row.id, { sha256: await sha256Of(await driver.createReadStream(location)) });
      }
      after = rows.at(-1)!.id;
      await save(after);
    }
    if (unreadable > 0) logger.warn("content hash not recorded: file missing, changed or volume offline", { files: unreadable });
  },
};

/**
 * Brings every mounted volume to this release's storage layout (npm run storage:migrate).
 * Each volume is READONLY while it migrates; an interrupted run resumes when started again.
 */
import { runScript } from "./lib/bootstrap.mjs";

const { db } = await import("../src/server/db/client");
const { listVolumesIn } = await import("../src/server/repositories/volume.repo");
const { migrateVolumeLayout } = await import("../src/server/services/storage-migration.service");

await runScript(async () => {
  let failed = false;
  for (const volume of await listVolumesIn(db(), ["ACTIVE", "READONLY", "DRAINING"])) {
    try {
      await migrateVolumeLayout(volume.id, (message) => console.log(message));
    } catch (error) {
      failed = true;
      console.error(`${volume.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failed ? 1 : 0;
});

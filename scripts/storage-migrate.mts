/**
 * Brings every mounted volume to this release's storage layout (npm run storage:migrate).
 * Each volume is READONLY while it migrates; an interrupted run resumes when started again.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { db } = await import("../src/server/db/client");
const { migrateVolumeLayout } = await import("../src/server/services/storage-migration.service");

let failed = false;
for (const volume of await db().storageVolume.findMany({ where: { status: { not: "OFFLINE" } }, select: { id: true } })) {
  try {
    await migrateVolumeLayout(volume.id, (message) => console.log(message));
  } catch (error) {
    failed = true;
    console.error(`${volume.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
await db().$disconnect();
if (failed) process.exit(1);

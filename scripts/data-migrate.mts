/**
 * Runs pending data migrations after `prisma migrate deploy` (npm run data:migrate).
 * Interrupted runs resume from their saved cursor; finished ones are skipped.
 */
import { runScript } from "./lib/bootstrap.mjs";

const { db } = await import("../src/server/db/client");
const { runDataMigrations } = await import("../src/server/migrations/data-migrations");
const { DATA_MIGRATIONS } = await import("../src/server/migrations/registry");

await runScript(async () => {
  const report = await runDataMigrations(db(), DATA_MIGRATIONS, (message) => console.log(message));
  console.log(`Data migrations: ${report.ran.length} ran, ${report.skipped.length} already done.`);
});

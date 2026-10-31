/**
 * Compares the database with the files on every ACTIVE/READONLY volume (npm run storage:fsck).
 *   npm run storage:fsck                      report only (changes nothing)
 *   npm run storage:fsck -- --fix             move orphans to the trash, flag missing files
 *   npm run storage:fsck -- --account <id>    one account
 * Exits 1 when anything was found, so it can run from cron and alert.
 */
import { runScript } from "./lib/bootstrap.mjs";

const { runFsck } = await import("../src/server/services/fsck.service");

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const accountAt = args.indexOf("--account");
const accountId = accountAt >= 0 ? args[accountAt + 1] : undefined;
if (accountAt >= 0 && !accountId) {
  console.error("usage: npm run storage:fsck -- [--fix] [--account <id>]");
  process.exit(2);
}

await runScript(async () => {
  const report = await runFsck({ fix, accountId });
  const list = (label: string, paths: readonly string[]) => paths.forEach((path) => console.log(`  ${label}  ${path}`));
  for (const entry of report.accounts) {
    console.log(`account ${entry.accountId} (volume ${entry.volumeId})`);
    list("missing on disk ", entry.missing);
    list("only on disk    ", entry.orphans);
    list("size differs    ", entry.sizeMismatch);
    list("not moved (link)", entry.notMoved);
    if (fix) console.log(`  fixed: ${entry.trashed} moved to the trash, ${entry.flagged} missing flags changed`);
  }
  for (const stray of report.strayAccounts) console.log(`volume ${stray.volumeId}: folder of unknown account ${stray.accountId}${stray.trashed ? " (moved to the trash)" : ""}`);

  const problems = report.accounts.length + report.strayAccounts.length;
  console.log(problems === 0 ? "storage:fsck: database and volumes agree." : `storage:fsck: ${problems} account(s) with differences${fix ? "" : " (run with --fix to repair)"}.`);
  return problems === 0 ? 0 : 1;
});

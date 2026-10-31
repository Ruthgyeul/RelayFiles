/**
 * Moves accounts between storage volumes (npm run volume:migrate -- …):
 *   --account <accountId> --to <volumeId>     one account
 *   --volume <volumeId> [--to <volumeId>]     every account on a volume (it stops taking new ones)
 * Files are copied, every SHA-256 is compared, then the account switches; the old copy waits
 * in the source volume's trash for STORAGE.trashRetentionHours. Run `npm run volume:list` first.
 */
import { parseArgs } from "node:util";
import { runScript } from "./lib/bootstrap.mjs";

const { values } = parseArgs({ options: { account: { type: "string" }, volume: { type: "string" }, to: { type: "string" } } });
const { drainVolume, moveAccountToVolume } = await import("../src/server/services/storage-migration.service");
const log = (message: string) => console.log(message);

await runScript(async () => {
  if (values.account && values.to) {
    const report = await moveAccountToVolume(values.account, values.to, log);
    console.log(report ? `Moved ${report.files} files (${report.bytes} bytes).` : "The account is already on that volume.");
    return 0;
  }
  if (values.volume) {
    const reports = await drainVolume(values.volume, values.to ?? null, log);
    console.log(`Moved ${reports.length} account(s).`);
    return 0;
  }
  console.error("Usage: npm run volume:migrate -- --account <id> --to <volumeId> | --volume <volumeId> [--to <volumeId>]");
  return 1;
});

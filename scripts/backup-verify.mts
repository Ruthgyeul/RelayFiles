/**
 * Second half of deploy/scripts/verify-backup.sh (npm run backup:verify): compares the dump the
 * shell restored into a scratch database with production and runs a report-only storage:fsck,
 * stores the result for the Server page and prints it as one JSON line for backup-verify.log.
 *   npm run -s backup:verify -- --dump-name <file> --dump-at <ISO time> --restored-url - --restore-ms <n>
 * The scratch database's connection string comes on stdin (`--restored-url -`): it carries a
 * password, and command lines are visible to every user on the server.
 *   npm run -s backup:verify -- [--dump-name <file> --dump-at <ISO time>] --failure "<what failed>"
 * Either form takes --offsite-failure "<what restic check said>" when the offsite repository failed its check.
 * Exits 1 when the backup is not usable, so cron can alert.
 */
import { parseArgs } from "node:util";
import { runScript } from "./lib/bootstrap.mjs";

const { values } = parseArgs({
  options: {
    "dump-name": { type: "string" },
    "dump-at": { type: "string" },
    "restored-url": { type: "string" },
    "restore-ms": { type: "string" },
    failure: { type: "string" },
    "offsite-failure": { type: "string" },
  },
});
const { verifyBackup } = await import("../src/server/services/backup-check.service");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

await runScript(async () => {
  const dumpAt = values["dump-at"] ? new Date(values["dump-at"]) : null;
  if (dumpAt && Number.isNaN(dumpAt.getTime())) throw new Error(`--dump-at is not a time: ${values["dump-at"]}`);
  const restoreMs = values["restore-ms"] === undefined ? null : Number(values["restore-ms"]);
  const check = await verifyBackup({
    dump: values["dump-name"] && dumpAt ? { name: values["dump-name"], at: dumpAt } : null,
    restoredUrl: values["restored-url"] === "-" ? (await readStdin()) || null : (values["restored-url"] ?? null),
    restoreMs: restoreMs !== null && Number.isFinite(restoreMs) ? restoreMs : null,
    failure: values.failure,
    offsiteFailure: values["offsite-failure"],
  });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...check }));
  return check.ok ? 0 : 1;
});

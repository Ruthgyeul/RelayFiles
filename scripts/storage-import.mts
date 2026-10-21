/**
 * Imports files from the server into an account, read as a tar stream on stdin so the
 * source keeps its own owner and permissions (docs/runbook.md "서버에 있는 파일 가져오기"):
 *   tar -C <folder> -cf - . | docker compose ... run --rm -T tools \
 *     npm run -s storage:import -- --account <id> [--to "Folder/Sub"] [--ignore-quota]
 * Files are copied (the source is never changed), hashed and recorded like uploads; images and
 * videos get thumbnails from the worker. Re-running skips files already there with the same size.
 */
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
import { extract } from "tar-stream";

nextEnv.loadEnvConfig(process.cwd());

const { importRelPath } = await import("../src/domain/import");
const { formatSize } = await import("../src/domain/format");
const { db } = await import("../src/server/db/client");
const { closeQueues } = await import("../src/server/jobs/queue");
const { redis } = await import("../src/server/redis");
const { findAccountById } = await import("../src/server/repositories/account.repo");
const { importFile, openImportTarget } = await import("../src/server/services/import.service");

const { values } = parseArgs({
  options: {
    account: { type: "string" },
    to: { type: "string", default: "" },
    "ignore-quota": { type: "boolean", default: false },
  },
});

if (!values.account || process.stdin.isTTY) {
  console.error('Usage: tar -C <folder> -cf - . | npm run -s storage:import -- --account <id> [--to "Folder"] [--ignore-quota]');
  process.exit(1);
}

let exitCode = 0;
try {
  const account = await findAccountById(db(), values.account);
  if (!account) throw new Error(`No account ${values.account}.`);
  if (!account.isAdmin && !account.neverExpire && account.expiresAt) {
    console.warn(`Note: ${account.name} expires ${account.expiresAt.toISOString()}; its files are deleted with it.`);
  }
  const target = await openImportTarget(account, values["ignore-quota"]);
  const counts = { imported: 0, skipped: 0, ignored: 0, bytes: 0 };

  for await (const entry of process.stdin.pipe(extract())) {
    const { name, type, size = 0 } = entry.header;
    const rel = importRelPath(name, values.to);
    if (type !== "file" || rel === null) {
      // Folders are created with their files; links, devices and unsafe names are not imported.
      if (type !== "directory") {
        console.warn(`ignored  ${name} (${type})`);
        counts.ignored++;
      }
      entry.resume();
      continue;
    }
    // tar-stream entries (streamx) are typed as unknown chunks; they yield Buffers.
    const result = await importFile(target, rel, size, entry as AsyncIterable<Uint8Array>);
    if (result.status === "skipped") {
      counts.skipped++;
      continue;
    }
    counts.imported++;
    counts.bytes += size;
    console.log(`imported ${rel}${result.file.name === rel.split("/").at(-1) ? "" : ` as ${result.file.name}`} (${formatSize(size)})`);
  }
  console.log(`Done: ${counts.imported} imported (${formatSize(counts.bytes)}), ${counts.skipped} already there, ${counts.ignored} ignored.`);
} catch (error) {
  console.error(`Import stopped: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Files imported so far are kept; run the same command again to continue.");
  exitCode = 1;
} finally {
  await closeQueues();
  await db().$disconnect();
  redis().disconnect();
}
process.exit(exitCode);

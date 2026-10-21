/**
 * Queues thumbnails for images and videos that have none (files uploaded while the worker
 * or Redis was down): npm run media:backfill
 * With `-- --previews`, queues every image large enough for a viewer preview instead (once,
 * after upgrading: files uploaded before previews existed have none).
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { closeQueues, enqueueMedia } = await import("../src/server/jobs/queue");
const { imagesForPreview, mediaWithoutThumbs } = await import("../src/server/repositories/node.repo");
const { db } = await import("../src/server/db/client");

const PAGE = 1_000;
const pageOf = process.argv.includes("--previews") ? imagesForPreview : mediaWithoutThumbs;
let queued = 0;
let after: string | undefined;
try {
  for (;;) {
    const rows = await pageOf(db(), PAGE, after);
    if (rows.length === 0) break;
    await enqueueMedia(rows.map((row) => row.id));
    queued += rows.length;
    after = rows.at(-1)!.id;
  }
  console.log(`Queued ${queued} file(s). Run "npm run worker" to process them.`);
} finally {
  await closeQueues();
  await db().$disconnect();
  process.exit(0);
}

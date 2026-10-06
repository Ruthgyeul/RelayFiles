/**
 * Queues thumbnails for images and videos that have none (files uploaded while the worker
 * or Redis was down): npm run media:backfill
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { closeQueues, enqueueMedia } = await import("../src/server/jobs/queue");
const { mediaWithoutThumbs } = await import("../src/server/repositories/node.repo");
const { db } = await import("../src/server/db/client");

const PAGE = 1_000;
let queued = 0;
let after: string | undefined;
try {
  for (;;) {
    const rows = await mediaWithoutThumbs(db(), PAGE, after);
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

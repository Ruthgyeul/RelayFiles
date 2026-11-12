/**
 * Queues thumbnails for images and videos that have none (files uploaded while the worker
 * or Redis was down): npm run media:backfill
 * With `-- --previews`, queues every image large enough for a viewer preview instead (once,
 * after upgrading: files uploaded before previews existed have none).
 * With `-- --derived`, queues every photo and video whose shared copy does not match
 * SHARE_METADATA_STRIP (after upgrading, or after changing it).
 */
import { runScript } from "./lib/bootstrap.mjs";

const { closeQueues, enqueueMedia } = await import("../src/server/jobs/queue");
const { imagesForPreview, mediaWithStaleCopies, mediaWithoutThumbs } = await import("../src/server/repositories/node.repo");
const { shareStripMode, storedStripMode } = await import("../src/server/media/strip-mode");
const { db } = await import("../src/server/db/client");

const PAGE = 1_000;
const stripMode = shareStripMode();
if (process.argv.includes("--derived") && stripMode === "none") {
  console.log("SHARE_METADATA_STRIP=none: shared files go out as uploaded, so there is nothing to make.");
  process.exit(0);
}
type Page = (client: Parameters<typeof mediaWithoutThumbs>[0], take: number, after?: string) => Promise<{ id: string }[]>;
const pageOf: Page = process.argv.includes("--derived")
  ? (client, take, after) => mediaWithStaleCopies(client, storedStripMode(stripMode === "none" ? "all" : stripMode), take, after)
  : process.argv.includes("--previews")
    ? imagesForPreview
    : mediaWithoutThumbs;
await runScript(async () => {
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
  }
});

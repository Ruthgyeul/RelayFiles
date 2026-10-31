import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { GET as preview } from "@/app/api/files/[id]/preview/route";
import { GET as stream } from "@/app/api/files/[id]/stream/route";
import { GET as thumb } from "@/app/api/files/[id]/thumb/route";
import { POST as removeNodes } from "@/app/api/nodes/delete/route";
import { getEnv } from "@/config/env";
import { IMMUTABLE_CACHE, MEDIA, PROCESS, TRANSCODE } from "@/config/policy";
import { exifOrientation } from "@/domain/image-metadata";
import { Queue } from "bullmq";
import { startMediaWorker, stopMediaWorker } from "@/server/jobs/media-worker";
import { closeQueues, enqueueMedia, enqueueTranscode, MEDIA_QUEUE, queueConnection } from "@/server/jobs/queue";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { layoutOf } from "@/server/storage/layout";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures } from "../../../../test/file-fixtures";
import { processMedia, recordDateTaken } from "@/server/media/process";
import { runningTranscodes } from "@/server/media/transcode";
import { storeTranscode } from "@/server/media/transcode-cache";
import { redis } from "@/server/redis";
import { slotsHeld } from "@/server/redis-semaphore";

const { prisma, member, addFile, get, cleanup } = fileFixtures();
const run = promisify(execFile);
const assetFile = (kind: "thumbs" | "derived" | "previews" | "transcoded", accountId: string, nodeId: string) => join(layoutOf(configuredVolumeRoot())[kind], accountId, nodeId);
const exists = (path: string) => stat(path).then(() => true, () => false);

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

/** A camera-like JPEG: rotated 90° (orientation 6), with GPS and device data. */
function cameraJpeg() {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: "#3fc1a5" } })
    .jpeg()
    .withExif({ IFD0: { Make: "RelayCam", Model: "Test Model X" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 33/1 0/1" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** Little-endian tag id of the EXIF pointer to the GPS block. */
const GPS_POINTER = Buffer.from([0x25, 0x88]);
/** "Exif\0\0" + TIFF header + one-entry IFD: the orientation-only block the stripper writes. */
const ORIENTATION_ONLY_EXIF_BYTES = 32;
/** Time a stopping worker may take beyond the SIGTERM grace (closing Redis connections). */
const SHUTDOWN_SLACK_MS = 3_000;

describe("media processing", () => {
  it("makes a thumbnail and a copy without location or camera data, keeping the original", async () => {
    const m = await member();
    const original = await cameraJpeg();
    expect(original.includes(Buffer.from("RelayCam"))).toBe(true);
    expect((await sharp(original).metadata()).exif!.includes(GPS_POINTER)).toBe(true);
    const id = await addFile(m, m.rootId, [], "photo.jpg", original, "image/jpeg", "IMAGE");

    expect(await processMedia(id)).toEqual({ thumb: true, derived: true, preview: false });
    expect(await prisma.node.findUniqueOrThrow({ where: { id } })).toMatchObject({ hasThumb: true, hasDerived: true });
    expect(await readFile(join(m.dir, "photo.jpg"))).toEqual(original);

    const derived = await readFile(assetFile("derived", m.id, id));
    for (const secret of ["RelayCam", "Test Model X"]) expect(derived.includes(Buffer.from(secret)), secret).toBe(false);
    const at = derived.indexOf(Buffer.from("Exif\0\0"));
    expect(exifOrientation(derived, at, derived.length)).toBe(6);
    const meta = await sharp(derived).metadata();
    expect([meta.width, meta.orientation, meta.exif?.length]).toEqual([64, 6, ORIENTATION_ONLY_EXIF_BYTES]);

    // The thumbnail is upright (rotated by its orientation) and carries no metadata.
    const res = await get(thumb, m, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const preview = Buffer.from(await res.arrayBuffer());
    const info = await sharp(preview).metadata();
    expect([info.width, info.height, info.exif]).toEqual([32, 64, undefined]);
    expect((await get(thumb, m, id, { "if-none-match": res.headers.get("etag")! })).status).toBe(304);
  });

  it("records the date taken from photo EXIF and video metadata", async () => {
    const m = await member();
    const shot = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: "2021:07:04 10:20:30", OffsetTimeOriginal: "+09:00" } })
      .toBuffer();
    const photo = await addFile(m, m.rootId, [], "shot.jpg", shot, "image/jpeg", "IMAGE");
    await processMedia(photo);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: photo } })).takenAt?.toISOString()).toBe("2021-07-04T01:20:30.000Z");

    const plain = await addFile(m, m.rootId, [], "plain.png", await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer(), "image/png", "IMAGE");
    expect(await recordDateTaken(plain)).toBe(false);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: plain } })).takenAt).toBeNull();

    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.mp4");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x36:rate=5", "-c:v", "mpeg4", "-metadata", "creation_time=2020-02-03T04:05:06Z", clip]);
      const video = await addFile(m, m.rootId, [], "clip.mp4", await readFile(clip), "video/mp4", "VIDEO");
      // The release data migration's job: only the date, thumbnails left alone.
      expect(await recordDateTaken(video)).toBe(true);
      expect(await prisma.node.findUniqueOrThrow({ where: { id: video } })).toMatchObject({ hasThumb: false });
      expect((await prisma.node.findUniqueOrThrow({ where: { id: video } })).takenAt?.toISOString()).toBe("2020-02-03T04:05:06.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("takes a video frame for the thumbnail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.webm");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-c:v", "libvpx-vp9", clip]);
      const m = await member();
      const id = await addFile(m, m.rootId, [], "clip.webm", await readFile(clip), "video/webm", "VIDEO");
      expect(await processMedia(id)).toEqual({ thumb: true, derived: false, preview: false });
      const info = await sharp(await readFile(assetFile("thumbs", m.id, id))).metadata();
      expect([info.format, info.width, info.height]).toEqual(["webp", 320, 180]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("opens uploads only as video files, never as playlists that point at other files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.mp4");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-c:v", "mpeg4", clip]);
      const segment = join(dir, "segment.ts");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-c:v", "mpeg2video", "-f", "mpegts", segment]);
      const m = await member();
      const real = await addFile(m, m.rootId, [], "real.mp4", await readFile(clip), "video/mp4", "VIDEO");
      expect((await processMedia(real))?.thumb).toBe(true);

      // An HLS playlist (stored as a video) that points at a file elsewhere on the server.
      const playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nfile://${segment}\n#EXT-X-ENDLIST\n`;
      const crafted = await addFile(m, m.rootId, [], "crafted.m3u8", playlist, "video/mp4", "VIDEO");
      expect((await processMedia(crafted))?.thumb).toBe(false);
      const converted = await get(stream, m, crafted, {}, "?transcode=1");
      expect((await converted.arrayBuffer()).byteLength).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips files it cannot decode and other types, and hides thumbnails from other accounts", async () => {
    const m = await member();
    const broken = await addFile(m, m.rootId, [], "broken.jpg", "not a jpeg", "image/jpeg", "IMAGE");
    expect(await processMedia(broken)).toEqual({ thumb: false, derived: false, preview: false });
    // Not tried again for every visitor: the share page answers 415 until the file changes.
    expect(await prisma.node.findUniqueOrThrow({ where: { id: broken } })).toMatchObject({ hasDerived: false, stripFailed: true });
    expect((await get(thumb, m, broken)).status).toBe(404);
    const text = await addFile(m, m.rootId, [], "notes.txt", "hello", "text/plain");
    expect(await processMedia(text)).toBeNull();

    const photo = await addFile(m, m.rootId, [], "p.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await processMedia(photo);
    const other = await member();
    expect((await get(thumb, other, photo)).status).toBe(404);
  });

  it("retries storage failures instead of recording the file as unprocessable", async () => {
    const m = await member();
    const facts = (id: string) => prisma.node.findUniqueOrThrow({ where: { id }, select: { hasThumb: true, hasDerived: true, stripFailed: true } });
    const before = { hasThumb: false, hasDerived: false, stripFailed: false };

    // The original cannot be read (an I/O error, the SSD came off): the job fails and is retried.
    const gone = await addFile(m, m.rootId, [], "gone.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await rm(join(m.dir, "gone.jpg"));
    await expect(processMedia(gone)).rejects.toThrow();
    expect(await facts(gone)).toEqual(before);

    // A decoder error while the volume is not mounted blames the storage, not the file.
    const broken = await addFile(m, m.rootId, [], "broken.jpg", "not a jpeg", "image/jpeg", "IMAGE");
    const { volume } = await prisma.account.findUniqueOrThrow({ where: { id: m.id }, select: { volume: { select: { mountPath: true } } } });
    const marker = layoutOf(volume.mountPath).marker;
    await rename(marker, `${marker}.hidden`);
    try {
      await expect(processMedia(broken)).rejects.toThrow();
    } finally {
      await rename(`${marker}.hidden`, marker);
    }
    expect(await facts(broken)).toEqual(before);
    // Back online, the retry finds the file itself undecodable.
    expect(await processMedia(broken)).toEqual({ thumb: false, derived: false, preview: false });
    expect(await facts(broken)).toEqual({ ...before, stripFailed: true });
  });

  it("removes generated files with the item", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "gone.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await processMedia(id);
    expect(await exists(assetFile("thumbs", m.id, id))).toBe(true);
    const res = await callRoute(removeNodes, { method: "POST", cookie: m.cookie, body: { ids: [id] } });
    expect(res.status).toBe(200);
    expect(await exists(assetFile("thumbs", m.id, id))).toBe(false);
    expect(await exists(assetFile("derived", m.id, id))).toBe(false);
  });

  it("makes a screen-sized preview of large photos for the viewer", async () => {
    const m = await member();
    // Noise does not compress, so this 3000 x 2000 JPEG is several megabytes.
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg({ quality: 95 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(MEDIA.previewMinBytes);
    const id = await addFile(m, m.rootId, [], "big.jpg", big, "image/jpeg", "IMAGE");
    expect(await processMedia(id)).toEqual({ thumb: true, derived: true, preview: true });

    const res = await get(preview, m, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    const shown = Buffer.from(await res.arrayBuffer());
    expect(shown.length).toBeLessThan(big.length);
    expect((await sharp(shown).metadata()).width).toBe(MEDIA.previewSizePx);
    expect((await get(preview, m, id, { "if-none-match": res.headers.get("etag")! })).status).toBe(304);

    // Small photos have no preview: the viewer gets the original.
    const small = await addFile(m, m.rootId, [], "small.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await processMedia(small);
    const original = await get(preview, m, small);
    expect(original.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(preview, await member(), id)).status).toBe(404);
  });

  it("stores a conversion of an often played video and plays it with Range requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.avi");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-c:v", "mpeg4", clip]);
      const m = await member();
      const id = await addFile(m, m.rootId, [], "clip.avi", await readFile(clip), "video/vnd.avi", "VIDEO");

      for (let play = 0; play < TRANSCODE.cacheAfterPlays; play++) {
        const live = await get(stream, m, id, {}, "?transcode=1");
        expect(live.headers.get("accept-ranges")).toBeNull();
        await live.arrayBuffer();
      }
      await expect.poll(runningTranscodes).toBe(0);
      expect(Number(await redis().get(`transcode:plays:${id}`))).toBe(TRANSCODE.cacheAfterPlays);

      // A worker that stops mid-way stops ffmpeg, keeps nothing and frees the slot (the job is retried).
      await expect(storeTranscode(id, AbortSignal.abort("worker stopping"))).rejects.toThrow("worker stopping");
      expect(await exists(assetFile("transcoded", m.id, id))).toBe(false);
      expect(await slotsHeld("transcode")).toBe(0);

      // What the worker runs once the plays are counted.
      expect(await storeTranscode(id)).toBe(true);
      const stored = await readFile(assetFile("transcoded", m.id, id));
      expect(stored.subarray(4, 8).toString()).toBe("ftyp");
      // faststart: the index (moov) comes before the media data.
      expect(stored.indexOf(Buffer.from("moov"))).toBeLessThan(stored.indexOf(Buffer.from("mdat")));

      const part = await get(stream, m, id, { range: "bytes=0-99" }, "?transcode=1");
      expect(part.status).toBe(206);
      expect(part.headers.get("content-type")).toBe("video/mp4");
      expect(part.headers.get("content-range")).toBe(`bytes 0-99/${stored.length}`);
      expect(Buffer.from(await part.arrayBuffer())).toEqual(stored.subarray(0, 100));

      // Deleting the video removes its stored conversion.
      expect((await callRoute(removeNodes, { method: "POST", cookie: m.cookie, body: { ids: [id] } })).status).toBe(200);
      expect(await exists(assetFile("transcoded", m.id, id))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("converts videos browsers cannot play while they stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.avi");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=1280x720:rate=10", "-c:v", "mpeg4", clip]);
      const m = await member();
      const id = await addFile(m, m.rootId, [], "clip.avi", await readFile(clip), "video/vnd.avi", "VIDEO");

      const res = await get(stream, m, id, {}, "?transcode=1");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
      const mp4 = Buffer.from(await res.arrayBuffer());
      // Fragmented MP4: a header box, then movie fragments the browser plays as they arrive.
      for (const box of ["ftyp", "moov", "moof", "mdat"]) expect(mp4.includes(Buffer.from(box)), box).toBe(true);

      await expect.poll(runningTranscodes).toBe(0);

      // A viewer who leaves mid-way stops the conversion (the process is killed and reaped).
      const long = join(dir, "long.avi");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=120:size=1280x720:rate=25", "-c:v", "mpeg4", "-q:v", "2", long]);
      const longId = await addFile(m, m.rootId, [], "long.avi", await readFile(long), "video/vnd.avi", "VIDEO");
      const reader = (await get(stream, m, longId, {}, "?transcode=1")).body!.getReader();
      await reader.read();
      expect(runningTranscodes()).toBe(1);
      await reader.cancel();
      await expect.poll(runningTranscodes, { timeout: 5_000 }).toBe(0);

      // Playing the original: cacheable for good, so seeking back or returning needs no request.
      expect((await get(stream, m, id, { range: "bytes=0-99" })).headers.get("cache-control")).toBe(IMMUTABLE_CACHE);

      const text = await addFile(m, m.rootId, [], "notes.txt", "hello", "text/plain");
      const missing = await get(stream, m, text, {}, "?transcode=1");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("no-store");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("processes queued jobs in the worker", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "queued.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    const worker = startMediaWorker();
    try {
      await enqueueMedia([id]);
      await expect.poll(async () => (await prisma.node.findUniqueOrThrow({ where: { id } })).hasThumb, { timeout: 10_000 }).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it("stops a running stored conversion when the worker stops, so shutdown is not held up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    const queue = new Queue(MEDIA_QUEUE, queueConnection("producer"));
    try {
      const long = join(dir, "long.avi");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=120:size=1280x720:rate=25", "-c:v", "mpeg4", "-q:v", "2", long]);
      const m = await member();
      const id = await addFile(m, m.rootId, [], "long.avi", await readFile(long), "video/vnd.avi", "VIDEO");
      const worker = startMediaWorker();
      await enqueueTranscode(id);
      await expect.poll(() => slotsHeld("transcode"), { timeout: 10_000 }).toBe(1);

      const started = Date.now();
      await stopMediaWorker(worker);
      // ffmpeg gets SIGTERM (SIGKILL after the grace); the conversion is not waited for.
      expect(Date.now() - started).toBeLessThan(PROCESS.killGraceMs + SHUTDOWN_SLACK_MS);
      expect(await slotsHeld("transcode")).toBe(0);
      expect(await exists(assetFile("transcoded", m.id, id))).toBe(false);
      // The job waits for a retry after the restart.
      const job = await queue.getJob(`transcode-${id}`);
      expect(await job?.getState()).toBe("delayed");
      await job?.remove();
    } finally {
      await queue.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

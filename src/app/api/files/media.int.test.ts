import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { GET as thumb } from "@/app/api/files/[id]/thumb/route";
import { POST as removeNodes } from "@/app/api/nodes/delete/route";
import { getEnv } from "@/config/env";
import { exifOrientation } from "@/domain/image-metadata";
import { startMediaWorker } from "@/server/jobs/media.worker";
import { closeQueues, enqueueMedia } from "@/server/jobs/queue";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { layoutOf } from "@/server/storage/layout";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures } from "../../../../test/file-fixtures";
import { processMedia } from "@/server/media/process";

const { prisma, member, addFile, get, cleanup } = fileFixtures();
const run = promisify(execFile);
const assetFile = (kind: "thumbs" | "derived", accountId: string, nodeId: string) => join(layoutOf(configuredVolumeRoot())[kind], accountId, nodeId);
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

describe("media processing", () => {
  it("makes a thumbnail and a copy without location or camera data, keeping the original", async () => {
    const m = await member();
    const original = await cameraJpeg();
    expect(original.includes(Buffer.from("RelayCam"))).toBe(true);
    expect((await sharp(original).metadata()).exif!.includes(GPS_POINTER)).toBe(true);
    const id = await addFile(m, m.rootId, [], "photo.jpg", original, "image/jpeg", "IMAGE");

    expect(await processMedia(id)).toEqual({ thumb: true, derived: true });
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

  it("takes a video frame for the thumbnail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-media-"));
    try {
      const clip = join(dir, "clip.webm");
      await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=10", "-c:v", "libvpx-vp9", clip]);
      const m = await member();
      const id = await addFile(m, m.rootId, [], "clip.webm", await readFile(clip), "video/webm", "VIDEO");
      expect(await processMedia(id)).toEqual({ thumb: true, derived: false });
      const info = await sharp(await readFile(assetFile("thumbs", m.id, id))).metadata();
      expect([info.format, info.width, info.height]).toEqual(["webp", 320, 180]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips files it cannot decode and other types, and hides thumbnails from other accounts", async () => {
    const m = await member();
    const broken = await addFile(m, m.rootId, [], "broken.jpg", "not a jpeg", "image/jpeg", "IMAGE");
    expect(await processMedia(broken)).toEqual({ thumb: false, derived: false });
    expect((await get(thumb, m, broken)).status).toBe(404);
    const text = await addFile(m, m.rootId, [], "notes.txt", "hello", "text/plain");
    expect(await processMedia(text)).toBeNull();

    const photo = await addFile(m, m.rootId, [], "p.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await processMedia(photo);
    const other = await member();
    expect((await get(thumb, other, photo)).status).toBe(404);
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
});

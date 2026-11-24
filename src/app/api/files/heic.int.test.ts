import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { GET as preview } from "@/app/api/files/[id]/preview/route";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { getEnv } from "@/config/env";
import { exifDateTaken, toInstant } from "@/domain/media-date";
import { newLinkId, newNodeId } from "@/domain/ids";
import { closeQueues } from "@/server/jobs/queue";
import { heicSupported } from "@/server/media/heic";
import { processMedia } from "@/server/media/process";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { fileFixtures, randomTestIp } from "../../../../test/file-fixtures";

const { prisma, member, addFile, get, cleanup } = fileFixtures();
const assetFile = (kind: "thumbs" | "derived" | "previews", accountId: string, nodeId: string) => join(layoutOf(configuredVolumeRoot())[kind], accountId, nodeId);

/**
 * A 64x48 HEIC photo (heif-enc) with the camera make, the date taken (2024:05:01 13:22:10, no
 * offset) and a GPS position in its EXIF block.
 */
const fixture = () => readFile(join(process.cwd(), "test/fixtures/photo.heic"));
/** CI's integration job sets this where its ffmpeg must read HEIC (the Docker image's does too). */
const mustDecode = process.env.EXPECT_FFMPEG_HEIC === "1";

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

/** SHARE_METADATA_STRIP for this test process (the parsed env is cached). */
function stripMode(mode: "sensitive" | "all" | "none") {
  (getEnv("jobs") as { SHARE_METADATA_STRIP: string }).SHARE_METADATA_STRIP = mode;
}

/** A HEIC photo in a public folder of a new account. */
async function sharedHeic() {
  const m = await member();
  const folderId = newNodeId();
  const linkId = newLinkId();
  await prisma.node.create({ data: { id: folderId, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Phone", linkId, visibility: "PUBLIC" } });
  const original = await fixture();
  const id = await addFile(m, folderId, ["Phone"], "IMG_0001.HEIC", original, "image/heic", "IMAGE");
  return { m, id, linkId, original };
}

function download(linkId: string, id: string) {
  const req = new NextRequest(`http://localhost/api/share/${linkId}/files/${id}/download`, { headers: { "x-real-ip": randomTestIp() } });
  return shareDownload(req, { params: Promise.resolve({ linkId, id }) });
}

describe("HEIC photos", () => {
  it("reads the date taken from the EXIF block, whatever the ffmpeg", async () => {
    const { id, original } = await sharedHeic();
    const exif = (await sharp(original).metadata()).exif!;
    expect(exifDateTaken(exif)).toEqual({ local: "2024-05-01T13:22:10", offset: null });
    await processMedia(id);
    const { takenAt } = await prisma.node.findUniqueOrThrow({ where: { id } });
    const expected = toInstant(exifDateTaken(exif)!, getEnv("jobs").JOBS_TIMEZONE, new Date());
    expect(expected).not.toBeNull();
    expect(takenAt?.toISOString()).toBe(expected?.toISOString());
  });

  it.runIf(mustDecode)("is decoded by the ffmpeg this run must support", async () => {
    expect(await heicSupported()).toBe(true);
  });

  it("gets a thumbnail, a preview and a JPEG for links without metadata when ffmpeg reads HEIC", async () => {
    stripMode("sensitive");
    const { m, id, linkId, original } = await sharedHeic();
    const supported = await heicSupported();
    const result = await processMedia(id);
    const row = await prisma.node.findUniqueOrThrow({ where: { id } });
    // The original is never changed.
    expect(await readFile(join(m.dir, "Phone", "IMG_0001.HEIC"))).toEqual(original);

    if (!supported) {
      // Too old an ffmpeg: nothing to show, and share links answer 415 instead of the original.
      expect(result).toEqual({ thumb: false, derived: false, preview: false });
      expect(row).toMatchObject({ hasThumb: false, hasDerived: false, stripFailed: true });
      expect((await download(linkId, id)).status).toBe(415);
      return;
    }

    expect(result).toEqual({ thumb: true, derived: true, preview: true });
    expect(row).toMatchObject({ hasThumb: true, hasDerived: true, derivedMode: "ALL", stripFailed: false });
    for (const kind of ["thumbs", "previews"] as const) {
      const meta = await sharp(await readFile(assetFile(kind, m.id, id))).metadata();
      expect([kind, meta.format]).toEqual([kind, "webp"]);
    }
    // The viewer always shows the preview: browsers other than Safari cannot open HEIC.
    expect((await get(preview, m, id)).headers.get("content-type")).toBe("image/webp");

    const copy = await readFile(assetFile("derived", m.id, id));
    const meta = await sharp(copy).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["jpeg", 64, 48, undefined]);
    expect(copy.includes(Buffer.from("RelayTest"))).toBe(false);

    // Visitors get the JPEG, named for what it is.
    const res = await download(linkId, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toContain("IMG_0001.jpg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(copy);
  });
});

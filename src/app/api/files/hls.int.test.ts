import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as hls } from "@/app/api/files/[id]/hls/[segment]/route";
import { getEnv } from "@/config/env";
import { TRANSCODE } from "@/config/policy";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { closeQueues } from "@/server/jobs/queue";
import { endHlsSessions, openHlsSessions, sweepHlsSessions } from "@/server/media/hls-session";
import { runningTranscodes } from "@/server/media/transcode";
import { acquireSlot, slotsHeld } from "@/server/redis-semaphore";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();
const run = promisify(execFile);
/** The first byte of every MPEG-TS packet. */
const TS_SYNC_BYTE = 0x47;
const CLIP_SECONDS = 30;

let clip: Buffer;
let work: string;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "relay-hls-"));
  const path = join(work, "clip.avi");
  // A video browsers cannot play, with sound, long enough for several segments.
  await run(getEnv("jobs").FFMPEG_PATH, ["-loglevel", "error", "-f", "lavfi", "-i", `testsrc=duration=${CLIP_SECONDS}:size=320x180:rate=10`, "-f", "lavfi", "-i", `sine=duration=${CLIP_SECONDS}`, "-c:v", "mpeg4", "-c:a", "mp3", path]);
  clip = await readFile(path);
});

afterAll(async () => {
  await endHlsSessions();
  await rm(work, { recursive: true, force: true });
  await closeQueues();
  await cleanup();
});

function get(m: FixtureMember, id: string, segment: string) {
  const req = new NextRequest(`http://localhost/api/files/${id}/hls/${segment}`, { headers: { cookie: `${SESSION_COOKIE}=${m.cookie}` } });
  return hls(req, { params: Promise.resolve({ id, segment }) });
}

/** Folders of HLS sessions in the volume's upload area. */
const sessionDirs = async () => (await readdir(layoutOf(configuredVolumeRoot()).uploads).catch(() => [] as string[])).filter((name) => name.startsWith("asset-"));

/** Start time (seconds) of the first packet in an MPEG-TS segment, as ffmpeg reads it. */
async function startOf(segment: Buffer): Promise<number> {
  const path = join(work, `probe-${Math.random()}.ts`);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, segment));
  const { stderr } = await run(getEnv("jobs").FFMPEG_PATH, ["-hide_banner", "-i", path, "-t", "0", "-f", "null", "-"]).catch((error: { stderr: string }) => ({ stderr: error.stderr }));
  return Number(/start: ([\d.]+)/.exec(stderr)![1]);
}

describe("HLS playback of converted videos", () => {
  it("lists the whole video and converts the segments the player asks for, from anywhere", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "clip.avi", clip, "video/vnd.avi", "VIDEO");

    const playlist = await get(m, id, "index.m3u8");
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    const text = await playlist.text();
    const segments = text.split("\n").filter((line) => /^\d+\.ts\?v=/.test(line));
    expect(segments).toHaveLength(Math.ceil(CLIP_SECONDS / TRANSCODE.hlsSegmentSec));
    expect(text).toContain(`#EXT-X-TARGETDURATION:${TRANSCODE.hlsSegmentSec}`);
    expect(text).toContain("#EXT-X-ENDLIST");

    const first = await get(m, id, "0.ts");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("video/mp2t");
    const firstBytes = Buffer.from(await first.arrayBuffer());
    expect(firstBytes[0]).toBe(TS_SYNC_BYTE);

    // A seek far ahead converts from there; its timestamps are those of the whole video.
    const far = 6;
    const seeked = Buffer.from(await (await get(m, id, `${far}.ts`)).arrayBuffer());
    expect(seeked[0]).toBe(TS_SYNC_BYTE);
    expect(Math.abs((await startOf(seeked)) - (await startOf(firstBytes)) - far * TRANSCODE.hlsSegmentSec)).toBeLessThan(0.5);

    for (const name of [`${segments.length}.ts`, "x.ts", "../index.m3u8"]) expect((await get(m, id, name)).status, name).toBe(404);
    // Another account's video is not found.
    expect((await get(await member(), id, "index.m3u8")).status).toBe(404);
    expect((await prisma.trafficDaily.findMany({ where: { accountId: m.id } })).reduce((sum, row) => sum + row.bytes, 0n)).toBeGreaterThan(0n);

    // Nobody asks any more: the session ends, ffmpeg stops and the segments go.
    expect(openHlsSessions()).toBe(1);
    await sweepHlsSessions(Date.now() + TRANSCODE.hlsIdleMs);
    expect(openHlsSessions()).toBe(0);
    expect(await sessionDirs()).toEqual([]);
    await expect.poll(runningTranscodes).toBe(0);
    expect(await slotsHeld("transcode")).toBe(0);
  });

  it("refuses a segment while the requester's conversion slots are taken", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "busy.avi", clip, "video/vnd.avi", "VIDEO");
    expect((await get(m, id, "index.m3u8")).status).toBe(200);
    const held = await Promise.all(Array.from({ length: TRANSCODE.maxPerRequester }, () => acquireSlot(`transcode:by:account:${m.id}`, TRANSCODE.maxPerRequester, TRANSCODE.slotLeaseMs)));
    try {
      const refused = await get(m, id, "0.ts");
      expect(refused.status).toBe(429);
      expect(runningTranscodes()).toBe(0);
    } finally {
      for (const slot of held) await slot?.release();
    }
    expect((await get(m, id, "0.ts")).status).toBe(200);
    await endHlsSessions();
  });

  it("does not list a file that is not a readable video", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "fake.avi", Buffer.from("not really a video"), "video/vnd.avi", "VIDEO");
    expect((await get(m, id, "index.m3u8")).status).toBe(404);
  });
});

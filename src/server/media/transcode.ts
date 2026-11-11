import "server-only";
import { spawn } from "node:child_process";
import { pipeline, Readable, Transform, type TransformCallback } from "node:stream";
import { getEnv } from "@/config/env";
import { IMMUTABLE_CACHE, TRANSCODE } from "@/config/policy";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { countOne } from "../metrics/counters";
import { acquireSlot, type SemaphoreSlot } from "../redis-semaphore";
import { ffmpegInput } from "./ffmpeg-input";

const globalForTranscode = globalThis as unknown as { relayTranscodes?: { running: number } };
const slots = (globalForTranscode.relayTranscodes ??= { running: 0 });

/** Conversions running now in this process. */
export const runningTranscodes = () => slots.running;

/** ffmpeg input and encoding: the first video and audio track as 720p H.264/AAC, without metadata. */
function encodeArgs(path: string): string[] {
  return [
    ...["-nostdin", "-hide_banner", "-loglevel", "error"],
    // Only the file itself as a video container; a seekable file also reads MP4/MOV with the index at the end.
    ...ffmpegInput(path),
    ...["-map", "0:v:0", "-map", "0:a:0?"],
    // No metadata or chapters from the source: phones write the recording place (©xyz) there.
    // No container, stream or chapter metadata (location, device) in the converted video.
    ...["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1"],
    // Even width, at most maxHeightPx tall, never enlarged.
    ...["-vf", `scale=-2:min(${TRANSCODE.maxHeightPx}\\,ih)`],
    ...["-c:v", "libx264", "-preset", TRANSCODE.preset, "-crf", String(TRANSCODE.crf), "-pix_fmt", "yuv420p"],
    ...["-c:a", "aac", "-b:a", TRANSCODE.audioBitrate],
  ];
}

/** Live conversion: fragmented MP4 on stdout, so the browser starts playing the first fragments while the rest converts. */
export function transcodeArgs(path: string): string[] {
  return [...encodeArgs(path), ...["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]];
}

/** Stored conversion: a regular MP4 with its index first (seekable with Range requests), at most maxOutputBytes. */
export function storedTranscodeArgs(path: string, output: string): string[] {
  return [...encodeArgs(path), ...["-movflags", "+faststart", "-fs", String(TRANSCODE.maxOutputBytes), "-f", "mp4", output]];
}

/** Passes bytes through, fails once more than `limit` went by, and remembers when bytes last moved. */
class OutputLimit extends Transform {
  private sent = 0;
  /** When output last passed through (a stalled reader stops the flow through backpressure). */
  lastFlowAt = Date.now();

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.sent += chunk.length;
    this.lastFlowAt = Date.now();
    done(this.sent > this.limit ? new Error("conversion output limit reached") : null, chunk);
  }
}

const busy = () => new ApiError("RATE_LIMITED", "The server is converting other videos. Try again shortly.", { retryAfter: TRANSCODE.busyRetrySec });
const ownBusy = () => new ApiError("RATE_LIMITED", "Another video is already converting for you. Close it or try again shortly.", { retryAfter: TRANSCODE.busyRetrySec });
/** Stands in for the shared slot while Redis is unreachable; the process limit still applies. */
const PROCESS_ONLY: SemaphoreSlot = { signal: new AbortController().signal, release: async () => undefined };

/** One of the `limit` slots `name` shared by every app process, or null when all are in use. */
async function slotOf(name: string, limit: number): Promise<SemaphoreSlot | null> {
  try {
    return await acquireSlot(name, limit, TRANSCODE.slotLeaseMs);
  } catch (error) {
    logger.warn("shared conversion slots unavailable; limiting this process only", { error });
    return PROCESS_ONLY;
  }
}

/** One of the VIDEO_TRANSCODE_MAX slots shared by every app process, or null when all are in use. */
export const sharedSlot = (limit: number) => slotOf("transcode", limit);

/** Releases slots, logging (not throwing) when Redis is unreachable. */
function releaseAll(held: readonly SemaphoreSlot[]): void {
  for (const slot of held) slot.release().catch((error: unknown) => logger.warn("conversion slot not released", { error }));
}

/**
 * Plays a video the browser cannot decode by converting it while it streams. At most
 * VIDEO_TRANSCODE_MAX conversions run at once across every app process (Redis slots), and at
 * most TRANSCODE.maxPerRequester for one `requester` (an account, or a link visitor's address
 * key). Each one is killed (SIGKILL) as soon as the viewer leaves, the output limit is
 * reached, nobody reads its output for TRANSCODE.idleTimeoutMs, it ran TRANSCODE.maxRunMs or
 * its shared slot is lost, and is always reaped (`close`).
 */
export async function transcodeResponse(req: Request, path: string, requester: string): Promise<Response> {
  // A finished conversion is kept by the browser: watching again costs no CPU.
  const headers = new Headers({ "content-type": "video/mp4", "cache-control": IMMUTABLE_CACHE, "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
  const { FFMPEG_PATH, VIDEO_TRANSCODE_MAX } = getEnv("jobs");
  if (VIDEO_TRANSCODE_MAX === 0) throw new ApiError("NOT_FOUND");
  if (req.method === "HEAD") return new Response(null, { headers });
  if (slots.running >= VIDEO_TRANSCODE_MAX) throw busy();
  const own = await slotOf(`transcode:by:${requester}`, TRANSCODE.maxPerRequester);
  if (!own) throw ownBusy();
  const slot = await sharedSlot(VIDEO_TRANSCODE_MAX);
  if (!slot) {
    releaseAll([own]);
    throw busy();
  }

  slots.running++;
  void countOne("transcodes_started");
  const started = Date.now();
  const child = spawn(FFMPEG_PATH, transcodeArgs(path), { stdio: ["ignore", "pipe", "ignore"], shell: false });
  const output = new OutputLimit(TRANSCODE.maxOutputBytes);
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  // A reader that stopped reading (paused, or slow on purpose) or a conversion that ran too
  // long gives its slots back.
  const watch = setInterval(() => {
    const now = Date.now();
    if (now - output.lastFlowAt < TRANSCODE.idleTimeoutMs && now - started < TRANSCODE.maxRunMs) return;
    logger.warn("video conversion stopped: output not read or running too long", { durationMs: now - started });
    stop();
  }, TRANSCODE.watchIntervalMs);
  watch.unref();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    slots.running--;
    clearInterval(watch);
    releaseAll([slot, own]);
  };
  child.on("error", (error) => {
    logger.warn("video conversion could not start", { error });
    release();
  });
  child.on("close", (code, signal) => {
    release();
    if (code !== 0 && signal !== "SIGKILL") logger.warn("video conversion failed", { code, signal, durationMs: Date.now() - started });
  });

  // The shared slot was lost (its lease lapsed and others took every slot): stop, or more than
  // VIDEO_TRANSCODE_MAX conversions would run. The viewer's player sees the stream end.
  const lost = () => {
    logger.warn("video conversion stopped: its conversion slot was lost");
    stop();
  };
  for (const held of [slot, own]) {
    held.signal.addEventListener("abort", lost, { once: true });
    child.once("close", () => held.signal.removeEventListener("abort", lost));
  }

  // The viewer closed, seeked away or the limit was hit: stop converting right away.
  pipeline(child.stdout, output, () => stop());
  output.once("close", stop);
  return new Response(Readable.toWeb(output) as ReadableStream, { headers });
}

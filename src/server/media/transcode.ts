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

/** ffmpeg arguments: the first video and audio track as 720p H.264/AAC in fragmented MP4. */
export function transcodeArgs(path: string): string[] {
  return [
    ...["-nostdin", "-hide_banner", "-loglevel", "error"],
    // Only the file itself as a video container; a seekable file also reads MP4/MOV with the index at the end.
    ...ffmpegInput(path),
    ...["-map", "0:v:0", "-map", "0:a:0?"],
    // No metadata or chapters from the source: phones write the recording place (©xyz) there.
    ...["-map_metadata", "-1", "-map_chapters", "-1"],
    // Even width, at most maxHeightPx tall, never enlarged.
    ...["-vf", `scale=-2:min(${TRANSCODE.maxHeightPx}\\,ih)`],
    ...["-c:v", "libx264", "-preset", TRANSCODE.preset, "-crf", String(TRANSCODE.crf), "-pix_fmt", "yuv420p"],
    ...["-c:a", "aac", "-b:a", TRANSCODE.audioBitrate],
    // Fragmented MP4: the browser starts playing the first fragments while the rest converts.
    ...["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"],
  ];
}

/** Passes bytes through and fails once more than `limit` went by. */
class OutputLimit extends Transform {
  private sent = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.sent += chunk.length;
    done(this.sent > this.limit ? new Error("conversion output limit reached") : null, chunk);
  }
}

const busy = () => new ApiError("RATE_LIMITED", "The server is converting other videos. Try again shortly.", { retryAfter: TRANSCODE.busyRetrySec });
/** Stands in for the shared slot while Redis is unreachable; the process limit still applies. */
const PROCESS_ONLY: SemaphoreSlot = { release: async () => undefined };

/** One of the VIDEO_TRANSCODE_MAX slots shared by every app process, or null when all are in use. */
async function sharedSlot(limit: number): Promise<SemaphoreSlot | null> {
  try {
    return await acquireSlot("transcode", limit, TRANSCODE.slotLeaseMs);
  } catch (error) {
    logger.warn("shared conversion slots unavailable; limiting this process only", { error });
    return PROCESS_ONLY;
  }
}

/**
 * Plays a video the browser cannot decode by converting it while it streams. At most
 * VIDEO_TRANSCODE_MAX conversions run at once across every app process (Redis slots); each
 * one is killed (SIGKILL) as soon as the viewer leaves or the output limit is reached, and is
 * always reaped (`close`).
 */
export async function transcodeResponse(req: Request, path: string): Promise<Response> {
  // A finished conversion is kept by the browser: watching again costs no CPU.
  const headers = new Headers({ "content-type": "video/mp4", "cache-control": IMMUTABLE_CACHE, "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
  const { FFMPEG_PATH, VIDEO_TRANSCODE_MAX } = getEnv("jobs");
  if (VIDEO_TRANSCODE_MAX === 0) throw new ApiError("NOT_FOUND");
  if (req.method === "HEAD") return new Response(null, { headers });
  if (slots.running >= VIDEO_TRANSCODE_MAX) throw busy();
  const slot = await sharedSlot(VIDEO_TRANSCODE_MAX);
  if (!slot) throw busy();

  slots.running++;
  void countOne("transcodes_started");
  const started = Date.now();
  const child = spawn(FFMPEG_PATH, transcodeArgs(path), { stdio: ["ignore", "pipe", "ignore"], shell: false });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    slots.running--;
    slot.release().catch((error: unknown) => logger.warn("conversion slot not released", { error }));
  };
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  child.on("error", (error) => {
    logger.warn("video conversion could not start", { error });
    release();
  });
  child.on("close", (code, signal) => {
    release();
    if (code !== 0 && signal !== "SIGKILL") logger.warn("video conversion failed", { code, signal, durationMs: Date.now() - started });
  });

  const output = new OutputLimit(TRANSCODE.maxOutputBytes);
  // The viewer closed, seeked away or the limit was hit: stop converting right away.
  pipeline(child.stdout, output, () => stop());
  output.once("close", stop);
  return new Response(Readable.toWeb(output) as ReadableStream, { headers });
}

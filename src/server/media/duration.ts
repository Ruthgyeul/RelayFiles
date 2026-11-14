import "server-only";
import { getEnv } from "@/config/env";
import { TRANSCODE } from "@/config/policy";
import { parseDuration } from "@/domain/hls";
import { logger } from "../logger";
import { CommandError, runCommand } from "../process/run-command";
import { redis } from "../redis";
import { ffmpegInput } from "./ffmpeg-input";

const durationKey = (version: string) => `hls:duration:${version}`;

/**
 * How long a video plays, in seconds, as ffmpeg reads it from the container (no decoding: `-t 0`);
 * null when the container does not say or ffmpeg cannot open the file. Kept in Redis by `version` (the content hash), so a
 * video is opened for this only once.
 */
export async function videoDuration(path: string, version: string): Promise<number | null> {
  const cached = await redis()
    .get(durationKey(version))
    .catch(() => null);
  if (cached !== null) return Number(cached);
  let log: string;
  try {
    log = (await runCommand(getEnv("jobs").FFMPEG_PATH, ["-nostdin", "-hide_banner", ...ffmpegInput(path), "-t", "0", "-f", "null", "-"], { timeoutMs: TRANSCODE.hlsProbeTimeoutMs, logFailures: false })).stderr;
  } catch (error) {
    // Not a video ffmpeg can open (or not one of the allowed containers): there is nothing to list.
    if (error instanceof CommandError && error.reason === "exit") return null;
    throw error;
  }
  const seconds = parseDuration(log);
  if (seconds !== null) {
    await redis()
      .set(durationKey(version), String(seconds), "EX", TRANSCODE.hlsDurationCacheSec)
      .catch((error: unknown) => logger.warn("video length not cached", { error }));
  }
  return seconds;
}

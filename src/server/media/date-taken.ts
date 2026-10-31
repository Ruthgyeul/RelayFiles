import "server-only";
import sharp from "sharp";
import { getEnv } from "@/config/env";
import { MEDIA, MS } from "@/config/policy";
import { exifDateTaken, toInstant, videoDateTaken, type MediaTime } from "@/domain/media-date";
import { runCommand } from "../process/run-command";
import { ffmpegInput } from "./ffmpeg-input";

/** The capture time recorded in a video container (ffmpeg's metadata listing). */
async function videoTime(path: string): Promise<MediaTime | null> {
  // -map_metadata 0: ffmpeg otherwise leaves creation_time out of its output. Nothing is decoded (-c copy -t 0).
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", ...ffmpegInput(path), "-map_metadata", "0", "-c", "copy", "-t", "0", "-f", "ffmetadata", "pipe:1"];
  const { stdout } = await runCommand(getEnv("jobs").FFMPEG_PATH, args, { timeoutMs: MEDIA.ffmpegTimeoutSec * MS.second, maxStdoutBytes: MEDIA.maxMetadataBytes });
  return videoDateTaken(stdout.toString("utf8"));
}

/** The capture time in an image's EXIF block (sharp reads only the header). */
async function imageTime(path: string): Promise<MediaTime | null> {
  const { exif } = await sharp(path, { limitInputPixels: MEDIA.maxInputPixels }).metadata();
  return exif ? exifDateTaken(exif) : null;
}

/**
 * When a photo or video was taken, from its own metadata; null when it records none. A time
 * without an offset is read in the server's zone (JOBS_TIMEZONE).
 */
export async function dateTaken(path: string, kind: "IMAGE" | "VIDEO", now: Date = new Date()): Promise<Date | null> {
  const time = kind === "VIDEO" ? await videoTime(path) : await imageTime(path);
  return time ? toInstant(time, getEnv("jobs").JOBS_TIMEZONE, now) : null;
}

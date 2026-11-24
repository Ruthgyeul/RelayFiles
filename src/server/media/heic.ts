import "server-only";
import sharp from "sharp";
import { getEnv } from "@/config/env";
import { MEDIA, MS } from "@/config/policy";
import { ffmpegReadsHeic } from "@/domain/heic";
import { runCommand } from "../process/run-command";
import { ffmpegInput } from "./ffmpeg-input";
import { ffmpegVersion } from "./ffmpeg-version";

/** Whether this host's ffmpeg reads HEIC photos (tile grids need ffmpeg 7.1). */
export async function heicSupported(): Promise<boolean> {
  return ffmpegReadsHeic((await ffmpegVersion())?.release ?? null);
}

/**
 * The whole photo as a PNG, decoded by ffmpeg (sharp's libheif has no HEVC decoder). ffmpeg 7.1
 * joins a tile grid into one picture and applies the photo's rotation; the input is opened only
 * as a local file through the MP4 family demuxer HEIF uses.
 */
export async function heicFrame(path: string): Promise<Buffer> {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", ...ffmpegInput(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
  const { stdout } = await runCommand(getEnv("jobs").FFMPEG_PATH, args, { timeoutMs: MEDIA.ffmpegTimeoutSec * MS.second, maxStdoutBytes: MEDIA.maxFrameBytes });
  if (stdout.length === 0) throw new Error("ffmpeg returned no picture");
  return stdout;
}

/** The share links' copy of a HEIC photo: a JPEG with no metadata at all (sharp writes none unless asked). */
export function heicPublicCopy(frame: Buffer): Promise<Buffer> {
  return sharp(frame, { limitInputPixels: MEDIA.maxInputPixels, failOn: "error" }).jpeg({ quality: MEDIA.heicCopyQuality }).toBuffer();
}

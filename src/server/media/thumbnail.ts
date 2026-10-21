import "server-only";
import sharp from "sharp";
import { getEnv } from "@/config/env";
import { MEDIA, MS } from "@/config/policy";
import { runCommand } from "../process/run-command";

/**
 * Small WebP preview of an image. `rotate()` applies the EXIF orientation; sharp writes no
 * metadata unless asked, so thumbnails never carry location or camera data.
 */
export async function imageThumbnail(input: string | Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MEDIA.maxInputPixels, failOn: "error" })
    .rotate()
    .resize(MEDIA.thumbSizePx, MEDIA.thumbSizePx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: MEDIA.thumbQuality })
    .toBuffer();
}

/** One PNG frame from a video at `seconds`, or an empty buffer when the clip is shorter. */
async function videoFrame(path: string, seconds: number): Promise<Buffer> {
  // The path is passed as an argument (no shell); "-nostdin" keeps ffmpeg from reading the terminal.
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
  const { stdout } = await runCommand(getEnv("jobs").FFMPEG_PATH, args, { timeoutMs: MEDIA.ffmpegTimeoutSec * MS.second, maxStdoutBytes: MEDIA.maxFrameBytes });
  return stdout;
}

/** WebP preview of a video: the frame at 1 s, or the first frame of shorter clips. */
export async function videoThumbnail(path: string): Promise<Buffer> {
  let frame = await videoFrame(path, MEDIA.videoFrameSeconds);
  if (frame.length === 0) frame = await videoFrame(path, 0);
  if (frame.length === 0) throw new Error("ffmpeg returned no frame");
  return imageThumbnail(frame);
}

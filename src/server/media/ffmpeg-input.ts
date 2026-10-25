import "server-only";
import { MEDIA } from "@/config/policy";

/**
 * ffmpeg arguments that open an uploaded file as input: only as a local file and only as one
 * of the allowed video containers (MEDIA.ffmpegDemuxers), whatever its name or content says.
 * The path is an argument (no shell).
 */
export function ffmpegInput(path: string): string[] {
  return ["-protocol_whitelist", MEDIA.ffmpegProtocols.join(","), "-format_whitelist", MEDIA.ffmpegDemuxers.join(","), "-i", path];
}

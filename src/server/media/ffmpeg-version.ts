import "server-only";
import { getEnv } from "@/config/env";
import { MEDIA, MS } from "@/config/policy";
import { ffmpegRelease, type FfmpegRelease } from "@/domain/heic";
import { runCommand } from "../process/run-command";

/** What `ffmpeg -version` said: its first line and release; null when ffmpeg did not run. */
export interface FfmpegVersion {
  line: string;
  release: FfmpegRelease | null;
}

let cached: Promise<FfmpegVersion | null> | null = null;

/** The FFMPEG_PATH binary's version, asked once per process (the binary does not change while it runs). */
export function ffmpegVersion(): Promise<FfmpegVersion | null> {
  cached ??= runCommand(getEnv("jobs").FFMPEG_PATH, ["-hide_banner", "-version"], { timeoutMs: MEDIA.ffmpegTimeoutSec * MS.second, logFailures: false })
    .then(({ stdout }) => {
      const text = stdout.toString("utf8");
      return { line: text.split("\n", 1)[0] ?? "", release: ffmpegRelease(text) };
    })
    .catch(() => null);
  return cached;
}

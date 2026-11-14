/**
 * HLS playback of converted videos (docs/architecture.md "미리보기 전송"): the server lists the
 * whole video as fixed-length segments up front (a VOD playlist), and converts the segments
 * the player asks for. Keyframes are forced at every segment boundary, so a conversion started
 * at any segment writes segments that line up with one started at the beginning.
 */
import { SECONDS } from "@/config/policy";

/** What a request under `…/hls/` asks for. */
export type HlsRequest = { kind: "playlist" } | { kind: "segment"; index: number };

export const HLS_PLAYLIST = "index.m3u8";
const SEGMENT_NAME = /^(\d{1,6})\.ts$/;

/** The file name of segment `index` (also the name ffmpeg writes it under). */
export const segmentName = (index: number) => `${index}.ts`;

/** `index.m3u8` or `<n>.ts` within the video's segments; null for anything else. */
export function parseHlsRequest(name: string, segments: number): HlsRequest | null {
  if (name === HLS_PLAYLIST) return { kind: "playlist" };
  const match = SEGMENT_NAME.exec(name);
  if (!match) return null;
  const index = Number(match[1]);
  return index < segments ? { kind: "segment", index } : null;
}

/** Segments of a video `durationSec` long. */
export function segmentCount(durationSec: number, segmentSec: number): number {
  return Math.max(1, Math.ceil(durationSec / segmentSec));
}

/** Start time of segment `index`, in seconds. */
export const segmentStart = (index: number, segmentSec: number) => index * segmentSec;

/** Seconds with the precision playlists use (no float noise like 3.9999999). */
const seconds = (value: number) => Number(value.toFixed(3)).toString();

/**
 * The VOD playlist of the whole video: every segment `segmentSec` long except a shorter last one.
 * `query` is added to each segment's name (the video's version, so cached segments are never stale).
 */
export function vodPlaylist(durationSec: number, segmentSec: number, query = ""): string {
  const count = segmentCount(durationSec, segmentSec);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(segmentSec)}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  for (let index = 0; index < count; index++) {
    const length = Math.min(segmentSec, durationSec - segmentStart(index, segmentSec));
    lines.push(`#EXTINF:${seconds(length > 0 ? length : segmentSec)},`, segmentName(index) + query);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** The length ffmpeg reports for its input ("Duration: 01:02:03.45"), in seconds; null when unknown. */
export function parseDuration(ffmpegLog: string): number | null {
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(ffmpegLog);
  if (!match) return null;
  const total = Number(match[1]) * SECONDS.hour + Number(match[2]) * SECONDS.minute + Number(match[3]);
  return total > 0 ? total : null;
}

/** The conversion running for a session: where it started, and whether it is still running. */
export interface HlsRun {
  start: number;
  running: boolean;
}

/**
 * What to do for a segment that is not written yet: wait for the running conversion when it
 * will reach the segment soon (it started at or before it, and has written the segment
 * `ahead` places earlier, or is that close to its start), else start a conversion there.
 * A conversion that started at the segment and stopped without writing it has failed.
 */
export function segmentPlan(run: HlsRun | null, index: number, ahead: number, written: (index: number) => boolean): "wait" | "restart" | "failed" {
  if (!run) return "restart";
  if (!run.running) return run.start === index ? "failed" : "restart";
  if (index < run.start) return "restart";
  const near = index - ahead <= run.start || written(index - ahead);
  return near ? "wait" : "restart";
}

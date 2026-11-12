import { globalTags } from "./media-date";
import type { StripMode } from "./image-metadata";

/**
 * Metadata of shared videos (docs/security.md "공유 링크·다운로드"). The worker copies the streams
 * without re-encoding and without any container, stream or chapter metadata, then writes back
 * only the tags kept here. Location (`com.apple.quicktime.location.ISO6709`, `location`),
 * software, owner and timed metadata tracks are never written.
 */

/** Global tags kept in `sensitive` mode: when the video was taken and on what device. */
const KEPT_TAGS: readonly string[] = [
  "creation_time",
  "date",
  "com.apple.quicktime.creationdate",
  "com.apple.quicktime.make",
  "com.apple.quicktime.model",
  "com.android.manufacturer",
  "com.android.model",
  "make",
  "model",
];

/** Longest tag value written back (dates and device names are short). */
const MAX_VALUE_LENGTH = 128;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The tags (key, value) to write on the shared copy, from `ffmpeg -f ffmetadata` output of the original. */
export function keptVideoTags(ffmetadata: string, mode: StripMode): [string, string][] {
  if (mode === "all") return [];
  const tags = globalTags(ffmetadata);
  return KEPT_TAGS.flatMap((key) => {
    const value = tags.get(key);
    return value && value.length <= MAX_VALUE_LENGTH && !CONTROL.test(value) ? [[key, value] as [string, string]] : [];
  });
}

/** How ffmpeg writes a copy of each video type: its muxer, and whether it is a QuickTime-family file. */
const MUXERS: Readonly<Record<string, { format: string; quicktime: boolean }>> = {
  "video/mp4": { format: "mp4", quicktime: true },
  "video/x-m4v": { format: "mp4", quicktime: true },
  "video/quicktime": { format: "mov", quicktime: true },
  "video/3gpp": { format: "3gp", quicktime: true },
  "video/3gpp2": { format: "3g2", quicktime: true },
  "video/webm": { format: "webm", quicktime: false },
  "video/x-matroska": { format: "matroska", quicktime: false },
  "video/matroska": { format: "matroska", quicktime: false },
  "video/x-msvideo": { format: "avi", quicktime: false },
  "video/vnd.avi": { format: "avi", quicktime: false },
  "video/x-ms-asf": { format: "asf", quicktime: false },
  "video/x-ms-wmv": { format: "asf", quicktime: false },
  "video/mp2t": { format: "mpegts", quicktime: false },
  "video/mpeg": { format: "mpeg", quicktime: false },
  "video/x-flv": { format: "flv", quicktime: false },
};

/**
 * ffmpeg arguments that copy a video without its metadata and with `tags` written back, or null
 * for a type it cannot copy (the shared copy then cannot be made and the video is not shared as is).
 * Data streams (timed metadata such as location tracks), attachments and chapters are left out.
 */
export function videoStripArgs(input: readonly string[], output: string, mime: string, tags: readonly [string, string][]): string[] | null {
  const muxer = MUXERS[mime];
  if (!muxer) return null;
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...input,
    "-map",
    "0:v",
    "-map",
    "0:a?",
    "-map",
    "0:s?",
    "-dn",
    "-c",
    "copy",
    "-map_metadata",
    "-1",
    "-map_metadata:s",
    "-1",
    "-map_chapters",
    "-1",
    ...tags.flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
    // Keys like com.apple.quicktime.creationdate are written only with use_metadata_tags.
    ...(muxer.quicktime ? ["-movflags", "+use_metadata_tags+faststart"] : []),
    "-f",
    muxer.format,
    "-y",
    output,
  ];
}

/** Whether a video type can get a shared copy without metadata. */
export const canStripVideo = (mime: string) => Object.hasOwn(MUXERS, mime);

/**
 * HEIC/HEIF photos: what the worker can do with them depends on the ffmpeg it runs (tile grids,
 * which iPhones write, need ffmpeg 7.1), and visitors get a JPEG copy instead of the original.
 */

import { MEDIA } from "@/config/policy";

const HEIC_TYPES: ReadonlySet<string> = new Set(MEDIA.heicTypes);

export const isHeicType = (mime: string): boolean => HEIC_TYPES.has(mime);

/** The type of a HEIC photo's copy for share links. */
export const HEIC_COPY_MIME = "image/jpeg";

/** An ffmpeg release as [major, minor]. */
export type FfmpegRelease = readonly [number, number];

/**
 * The release in `ffmpeg -version`'s first line ("ffmpeg version 7.1.1-1+b1 …",
 * "ffmpeg version n7.1 …"); null for a build without one (a git snapshot "N-118000-g…").
 */
export function ffmpegRelease(versionOutput: string): FfmpegRelease | null {
  const match = /^ffmpeg version n?(\d+)\.(\d+)/m.exec(versionOutput);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Whether this ffmpeg release reads HEIC photos (tile grids). Unknown versions are not trusted. */
export function ffmpegReadsHeic(release: FfmpegRelease | null): boolean {
  if (!release) return false;
  const [major, minor] = release;
  const [needMajor, needMinor] = MEDIA.heicMinFfmpeg;
  return major > needMajor || (major === needMajor && minor >= needMinor);
}

/** The name of a HEIC photo's JPEG copy for share links: "IMG_0042.HEIC" → "IMG_0042.jpg" (a zip path keeps its folders). */
export function heicCopyName(name: string): string {
  const start = name.lastIndexOf("/") + 1;
  const dot = name.lastIndexOf(".");
  return `${dot > start ? name.slice(0, dot) : name}.jpg`;
}

/** The Server page's ffmpeg row: which ffmpeg runs and whether HEIC photos get thumbnails. */
export function ffmpegStatusText(version: { line: string; release: FfmpegRelease | null } | null): { detail: string; heic: boolean } {
  if (!version) return { detail: "ffmpeg not found (video thumbnails, conversion and HEIC photos need it)", heic: false };
  const name = version.line.replace(/^ffmpeg version /, "ffmpeg ").replace(/ Copyright.*$/, "");
  return ffmpegReadsHeic(version.release)
    ? { detail: `${name} · HEIC photos supported`, heic: true }
    : { detail: `${name} · HEIC photos need ffmpeg ${MEDIA.heicMinFfmpeg.join(".")}: they get no thumbnail or preview`, heic: false };
}

/**
 * {@link heicCopyName} for an entry of a zip that holds other entries (`taken`): when another
 * file already has that name ("IMG_0042.jpg" next to "IMG_0042.HEIC"), "IMG_0042.HEIC.jpg",
 * then "IMG_0042 (2).jpg", "IMG_0042 (3).jpg", …
 */
export function uniqueHeicCopyName(name: string, taken: ReadonlySet<string>): string {
  const plain = heicCopyName(name);
  if (!taken.has(plain)) return plain;
  const kept = `${name}.jpg`;
  if (!taken.has(kept)) return kept;
  const stem = plain.slice(0, -".jpg".length);
  for (let copy = 2; ; copy++) {
    const candidate = `${stem} (${copy}).jpg`;
    if (!taken.has(candidate)) return candidate;
  }
}

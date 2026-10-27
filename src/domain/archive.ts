/**
 * Entry names for zip downloads. Names on disk may contain "\" and ":" (ext4 allows them), but
 * zip tools on Windows and archiver itself read "\" as a separator: "..\..\evil.txt" would be
 * stored as "../../evil.txt" and extracted outside the target folder (zip slip). Each segment
 * is made inert here instead of trusting the extractor.
 */

const ZIP_SEPARATOR = "/";
const REPLACEMENT = "_";
const UNSAFE_CHARS = /[\\:\u0000-\u001f\u007f]/g;
const RELATIVE_SEGMENTS = new Set([".", ".."]);

/** One path segment with separators, drive letters and control characters replaced. */
export function zipSegment(segment: string): string {
  const cleaned = segment.replace(UNSAFE_CHARS, REPLACEMENT);
  return RELATIVE_SEGMENTS.has(cleaned) || cleaned === "" ? REPLACEMENT : cleaned;
}

/** A "/"-separated entry path that can only extract inside the target folder. */
export function zipEntryName(path: string): string {
  return path.split(ZIP_SEPARATOR).map(zipSegment).join(ZIP_SEPARATOR);
}

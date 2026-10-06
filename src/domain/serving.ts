/**
 * HTTP rules for serving files: byte ranges (video seeking) and which types may be shown
 * inline. Everything else is sent as an attachment so a crafted file (HTML, SVG) can never
 * run in the app's origin (docs/plan.md §13.5).
 */

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * Parses a single "bytes=" range against the file size. Returns null for no/ignored range,
 * "unsatisfiable" when it lies outside the file. Multi-range requests are served whole.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText = "", endText = ""] = match;
  if (startText === "" && endText === "") return null;
  if (size === 0) return "unsatisfiable";
  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

/** Media the browser may render inline (viewer, inline player, thumbnails). */
const INLINE_PREFIXES = ["video/", "audio/", "image/"];
const NEVER_INLINE = new Set(["image/svg+xml"]);

export function canShowInline(mime: string): boolean {
  return INLINE_PREFIXES.some((prefix) => mime.startsWith(prefix)) && !NEVER_INLINE.has(mime);
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name (Korean names, spaces). */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Zip name like the design: "Folder.zip", "file.zip", or "Parent · 3 items.zip". */
export function zipName(items: { name: string; folder: boolean }[], parentName: string): string {
  const [first] = items;
  if (items.length === 1 && first) return `${first.folder ? first.name : first.name.replace(/\.[^.]+$/, "") || first.name}.zip`;
  return `${parentName} · ${items.length} items.zip`;
}

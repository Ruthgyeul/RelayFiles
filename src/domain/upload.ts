/**
 * Upload rules from the design (`startUpload`): every Home upload gets its own folder,
 * named after the single top-level folder, the single file, or the upload time.
 */
import type { NodeKind } from "./tree";

/** Folder name and relative paths for a Home upload. */
export function homeUploadPlan(rels: readonly string[], fallbackName: string): { name: string; rels: string[] } {
  const tops = new Set(rels.map((rel) => (rel.includes("/") ? rel.split("/")[0]! : null)));
  const oneDir = tops.size === 1 && !tops.has(null) ? [...tops][0]! : null;
  if (oneDir) return { name: oneDir, rels: rels.map((rel) => rel.slice(oneDir.length + 1)) };
  if (rels.length === 1) return { name: rels[0]!.replace(/\.[^.]+$/, "") || rels[0]!, rels: [...rels] };
  return { name: fallbackName, rels: [...rels] };
}

/** "Upload Oct 5, 3:12 PM" in the uploader's locale settings (design fallback name). */
export function uploadFallbackName(at: Date): string {
  return `Upload ${at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

/** Number of distinct folders a set of relative paths creates (transfer panel "N folders"). */
export function folderCount(rels: readonly string[]): number {
  const dirs = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split("/").slice(0, -1);
    parts.forEach((_, index) => dirs.add(parts.slice(0, index + 1).join("/")));
  }
  return dirs.size;
}

/** Media kind from a MIME type (design `kindOf`). */
export function kindFromMime(mime: string): NodeKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

/** MIME types by extension for files whose content does not identify them (text, some audio). */
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function mimeFromName(name: string): string {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || "application/octet-stream";
}

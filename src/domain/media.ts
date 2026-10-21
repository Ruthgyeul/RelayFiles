import type { NodeKind } from "./tree";

export type PreviewKind = "image" | "video" | "audio";

/**
 * What a list shows under a file name: a picture (image or video frame) or an audio player.
 * Folders and other files have no preview.
 */
export function previewKindOf(type: "file" | "folder", kind: NodeKind | null): PreviewKind | null {
  if (type !== "file") return null;
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}

/**
 * Video containers browsers do not play (AVI, WMV, MPEG-PS/TS, Flash, 3GP, RealMedia, ...).
 * They play through the server's conversion; MP4, MOV, WebM and MKV are tried as they are and
 * only converted when the browser reports it cannot decode them.
 */
const CONVERT_EXTENSIONS: ReadonlySet<string> = new Set([
  "avi", "divx", "wmv", "asf", "flv", "f4v", "mpg", "mpeg", "m2v", "vob", "mts", "m2ts", "3gp", "3g2", "ogm", "mxf", "rm", "rmvb",
]);

/** Whether a video must be converted to play in a browser, judged by its file name. */
export function videoNeedsTranscode(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && CONVERT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

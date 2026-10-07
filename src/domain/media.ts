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

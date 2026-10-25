import { DOCUMENT_PREVIEW } from "@/config/policy";
import { documentPreviewOf } from "./file-format";
import { limitHit } from "./share";
import type { ByteRange } from "./serving";
import type { NodeKind } from "./tree";

/**
 * What a visitor may fetch from a share link: whether a file can be downloaded, which
 * download requests are counted, and how much of a file the viewer's playback route sends.
 * The server and the share page use the same rules (docs/security.md "Share links").
 */

export interface DownloadFacts {
  /** The link was set to "Stream only". */
  linkStreamOnly: boolean;
  /** The file itself was set to "Stream only". */
  streamOnly: boolean;
  downloadLimit: number | null;
  downloads: number;
  /** 0 normal, 1 throttled, 2 paused (see `busyOf`). */
  busyLevel: 0 | 1 | 2;
}

export type DownloadBlock = "stream-only" | "limit" | "paused";

/** Why visitors may not download a file now, or null when they may (design `canDl`). */
export function downloadBlock(facts: DownloadFacts): DownloadBlock | null {
  if (facts.linkStreamOnly || facts.streamOnly) return "stream-only";
  if (limitHit(facts.downloadLimit, facts.downloads)) return "limit";
  if (facts.busyLevel === 2) return "paused";
  return null;
}

export type DownloadDecision = "count" | "allow" | "deny";

export interface DownloadRequest {
  method: string;
  /** The parsed Range header (`parseRange`) against the bytes being sent. */
  range: ByteRange | null | "unsatisfiable";
  owner: boolean;
  /** This visitor started (and was counted for) a download of the file recently. */
  granted: boolean;
}

/**
 * How a download request is treated. A request that sends the first byte starts a download
 * and is counted; a Range request that starts later (a resumed download) is only served to a
 * visitor whose start was counted. Deciding by the parsed range, not the header text, closes
 * suffix ranges (`bytes=-N`) that read the whole file without starting at byte 0.
 */
export function downloadDecision(request: DownloadRequest): DownloadDecision {
  if (request.owner || request.method !== "GET" || request.range === "unsatisfiable") return "allow";
  if (request.range === null || request.range.start === 0) return "count";
  return request.granted ? "allow" : "deny";
}

/**
 * How far into a file a visitor's playback request may read (exclusive), "any" for formats
 * the viewer reads anywhere (media, PDF), null for formats the viewer cannot show. Text and
 * asset previews only ever read the file's head, so the stream route is not a second
 * download route for them (docs/security.md: Stream only is not DRM).
 */
export function streamReach(name: string, kind: NodeKind | null): number | "any" | null {
  if (kind === "video" || kind === "audio") return "any";
  const preview = documentPreviewOf(name, kind);
  if (!preview) return "any";
  switch (preview.preview) {
    case null:
      return null;
    case "pdf":
      return "any";
    case "text":
    case "code":
    case "markdown":
    case "table":
      return DOCUMENT_PREVIEW.textMaxBytes;
    case "svg":
    case "font":
    case "docx":
    case "spreadsheet":
      return DOCUMENT_PREVIEW.assetMaxBytes;
  }
}

/** Whether a playback request for `size` bytes stays within `reach` (see {@link streamReach}). */
export function withinReach(reach: number | "any" | null, range: ByteRange | null | "unsatisfiable", size: number): boolean {
  if (reach === null) return false;
  if (reach === "any" || range === "unsatisfiable") return true;
  const end = range ? range.end : size - 1;
  return end < reach;
}

import "server-only";
import { TRANSCODE } from "@/config/policy";
import { parseHlsRequest, segmentCount, vodPlaylist, type HlsRequest } from "@/domain/hls";
import { ApiError } from "../http/api-error";
import { videoDuration } from "./duration";
import { hlsSegment } from "./hls-session";

export interface HlsVideo {
  nodeId: string;
  /** The original on the volume. */
  path: string;
  /** The content hash (or another id of this version of the file). */
  version: string;
  /** Who the conversion is counted against (an account, or a link visitor's address). */
  requester: string;
  /** A new folder in the volume's upload area (StorageDriver.stagingPath). */
  newDir: () => Promise<string>;
}

/** Checks that `name` (`index.m3u8` or `<n>.ts`) is part of the video; 404 when it is not or the length is unknown. */
export async function hlsRequestOf(video: HlsVideo, name: string): Promise<{ request: HlsRequest; durationSec: number }> {
  const durationSec = await videoDuration(video.path, video.version);
  if (durationSec === null) throw new ApiError("NOT_FOUND");
  const request = parseHlsRequest(name, segmentCount(durationSec, TRANSCODE.hlsSegmentSec));
  if (!request) throw new ApiError("NOT_FOUND");
  return { request, durationSec };
}

/**
 * The playlist (every segment of the video, named with its version so cached segments are never
 * stale) or one segment, converted when the player asks for it.
 */
export async function hlsResponse(video: HlsVideo, { request, durationSec }: { request: HlsRequest; durationSec: number }, onServe?: (bytes: number) => void): Promise<Response> {
  if (request.kind === "playlist") {
    const body = vodPlaylist(durationSec, TRANSCODE.hlsSegmentSec, `?v=${encodeURIComponent(video.version)}`);
    return new Response(body, { headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "private, no-cache", "x-content-type-options": "nosniff" } });
  }
  return hlsSegment({ key: `${video.nodeId}:${video.version}:${video.requester}`, path: video.path, requester: video.requester, newDir: video.newDir }, request.index, onServe);
}

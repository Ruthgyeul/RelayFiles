import type { ErrorCode } from "./errors";

/** Every API route responds with this envelope (CLAUDE.md "API · 보안"). */
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: string;
  code: ErrorCode;
  /** Field-level validation messages, keyed by field path. */
  fields?: Record<string, string>;
  /** Seconds until a rate-limited request may be retried. */
  retryAfter?: number;
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Header carrying the per-request id (shown on error pages for support). */
export const REQUEST_ID_HEADER = "x-request-id";

/** Marks a viewer's look-ahead request for the next image (not counted as a view). */
export const PREFETCH_HEADER = "x-relayfiles-prefetch";

/** Query parameter a viewer adds when it reads a video's subtitle file through a stream route (not a view of that file). */
export const SUBTITLE_PARAM = { name: "subtitle", value: "1" } as const;

/**
 * How a video that browsers cannot decode is played. `<base>` is a file's route (`/api/files/<id>`
 * or `/api/share/<link>/files/<id>`): `<base>/stream?transcode=1` plays a stored conversion with
 * Range requests, or a live one from the start; `<base>/hls/index.m3u8` converts from wherever
 * the player seeks. A response of the first says which it is in TRANSCODE_HEADER (also for HEAD).
 */
export const CONVERSION = {
  streamSuffix: "/stream?transcode=1",
  hlsSuffix: "/hls/index.m3u8",
  header: "x-relayfiles-transcode",
} as const;
export type ConversionKind = "stored" | "live";

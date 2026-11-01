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

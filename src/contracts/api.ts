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

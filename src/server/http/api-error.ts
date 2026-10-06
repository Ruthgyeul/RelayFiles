import "server-only";
import { ERRORS, type ErrorCode } from "@/contracts/errors";

/** An expected failure with a client-safe message. Anything else becomes INTERNAL. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string = ERRORS[code].message,
    readonly options: { fields?: Record<string, string>; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = ERRORS[code].status;
  }
}

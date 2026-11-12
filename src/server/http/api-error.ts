import "server-only";
import { ERRORS, type ErrorCode } from "@/contracts/errors";

/**
 * Said when a file or folder the database does not know sits on the disk where an item would
 * go (the two are out of step): nothing is replaced, and `storage:fsck` shows what it is.
 */
export const DISK_IN_THE_WAY_MESSAGE = "Something on the server's disk is in the way. Ask the admin to run a storage check, then try again.";

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

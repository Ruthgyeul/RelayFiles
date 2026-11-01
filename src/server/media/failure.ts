import "server-only";
import type { ErrorCode } from "@/contracts/errors";
import { ApiError } from "../http/api-error";
import { CommandError, type CommandFailure } from "../process/run-command";

/**
 * errno codes that blame the storage or the system, not the file: I/O errors, a full or
 * read-only disk, a device that went away (the file "disappears" with the SSD), permissions
 * and resource limits.
 */
const STORAGE_ERRNO: ReadonlySet<string> = new Set([
  "EIO",
  "ENOSPC",
  "EDQUOT",
  "EROFS",
  "ENOENT",
  "ENOTDIR",
  "ENODEV",
  "ENXIO",
  "ESTALE",
  "ENOTCONN",
  "EBUSY",
  "EAGAIN",
  "ETIMEDOUT",
  "EACCES",
  "EPERM",
  "EMFILE",
  "ENFILE",
  "ENOMEM",
]);

/** Commands that did not get to judge the file: stopped after their timeout, aborted, or not started. */
const RETRIED_COMMANDS: ReadonlySet<CommandFailure> = new Set(["timeout", "aborted", "spawn"]);

/** API errors that say the volume cannot be used right now. */
const STORAGE_API_ERRORS: ReadonlySet<ErrorCode> = new Set(["STORAGE_OFFLINE", "STORAGE_BUSY"]);

/**
 * Whether a failed media step should be tried again later (BullMQ backoff) rather than
 * recorded for good as "this file cannot be processed". Decoder errors (sharp, ffmpeg exiting
 * with an error, a malformed segment) are not transient by themselves: the caller also checks
 * that the original and its volume are still readable before blaming the file.
 */
export function isTransientMediaError(error: unknown): boolean {
  if (error instanceof CommandError) return RETRIED_COMMANDS.has(error.reason);
  if (error instanceof ApiError) return STORAGE_API_ERRORS.has(error.code);
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" && STORAGE_ERRNO.has(code);
}

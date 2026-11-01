import { describe, expect, it } from "vitest";
import { ApiError } from "../http/api-error";
import { CommandError, type CommandFailure } from "../process/run-command";
import { isTransientMediaError } from "./failure";

const errno = (code: string) => Object.assign(new Error(`${code}: failed`), { code });
const command = (reason: CommandFailure) => new CommandError(reason, { pid: 1, stdout: Buffer.alloc(0), stderr: "", code: null, signal: null }, reason);

describe("isTransientMediaError", () => {
  it("retries storage and system errors", () => {
    for (const code of ["EIO", "ENOSPC", "EROFS", "ENOENT", "ENODEV", "ESTALE", "EACCES", "EMFILE"]) expect(isTransientMediaError(errno(code)), code).toBe(true);
    expect(isTransientMediaError(new ApiError("STORAGE_OFFLINE"))).toBe(true);
    expect(isTransientMediaError(new ApiError("STORAGE_BUSY"))).toBe(true);
  });

  it("retries commands that did not get to judge the file", () => {
    for (const reason of ["timeout", "aborted", "spawn"] as const) expect(isTransientMediaError(command(reason)), reason).toBe(true);
  });

  it("leaves decoder errors to the storage check", () => {
    expect(isTransientMediaError(new Error("VipsJpeg: Premature end of JPEG file"))).toBe(false);
    expect(isTransientMediaError(command("exit"))).toBe(false);
    expect(isTransientMediaError(command("output-limit"))).toBe(false);
    expect(isTransientMediaError(errno("EINVAL"))).toBe(false);
    expect(isTransientMediaError(new ApiError("NOT_FOUND"))).toBe(false);
    expect(isTransientMediaError("not an error")).toBe(false);
    expect(isTransientMediaError(null)).toBe(false);
  });
});

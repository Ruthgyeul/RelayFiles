import "server-only";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { PROCESS } from "@/config/policy";
import { logger } from "../logger";

export interface RunOptions {
  /** The command is stopped (SIGTERM, then SIGKILL) after this long. */
  timeoutMs: number;
  /** Bytes of stdout kept; more stops the command with an error. */
  maxStdoutBytes?: number;
  /** Log timeouts, failed starts and non-zero exits (off for commands that fail as a normal answer). */
  logFailures?: boolean;
  /** Stops the command like a timeout (SIGTERM, then SIGKILL) when aborted: worker shutdown, a lost conversion slot. */
  signal?: AbortSignal;
}

export interface CommandResult {
  pid: number | undefined;
  stdout: Buffer;
  stderr: string;
}

export type CommandFailure = "exit" | "timeout" | "output-limit" | "spawn" | "aborted";

/** A command that did not exit with 0. Keeps the output: some tools answer through a non-zero exit. */
export class CommandError extends Error {
  constructor(
    readonly reason: CommandFailure,
    readonly result: CommandResult & { code: number | null; signal: NodeJS.Signals | null },
    detail: string,
  ) {
    super(detail);
    this.name = "CommandError";
  }
}

/**
 * Runs a program without a shell (no grandchildren that could outlive it) and settles only
 * when the child has exited and been reaped (`close`), so no call leaves a zombie or a
 * running process behind. On timeout or abort the child gets SIGTERM, then SIGKILL after
 * PROCESS.killGraceMs. Output is capped in memory. Logs name the program only: arguments can
 * hold file names.
 */
export function runCommand(command: string, args: readonly string[], options: RunOptions): Promise<CommandResult> {
  const { timeoutMs, maxStdoutBytes = PROCESS.maxOutputBytes, logFailures = true, signal: abortSignal } = options;
  const program = basename(command);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let failure: CommandFailure | null = null;
    let spawnError: Error | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    const stop = (reason: CommandFailure) => {
      if (failure) return;
      failure = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), PROCESS.killGraceMs);
    };
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    const abort = () => stop("aborted");
    if (abortSignal?.aborted) abort();
    else abortSignal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) return stop("output-limit");
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < PROCESS.maxStderrBytes) stderr += chunk.toString().slice(0, PROCESS.maxStderrBytes - stderr.length);
    });
    // A failed start (ENOENT, EACCES) still ends with `close`, which settles the promise.
    child.on("error", (error) => {
      spawnError = error;
      failure ??= "spawn";
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      abortSignal?.removeEventListener("abort", abort);
      const result = { pid: child.pid, stdout: Buffer.concat(chunks), stderr: stderr.trim() };
      if (!failure && code === 0) return resolve(result);
      const reason: CommandFailure = failure ?? "exit";
      const detail =
        reason === "spawn"
          ? `${program} could not start: ${(spawnError as NodeJS.ErrnoException | null)?.code ?? "unknown error"}`
          : reason === "timeout"
            ? `${program} did not finish within ${timeoutMs} ms`
            : reason === "output-limit"
              ? `${program} wrote more than ${maxStdoutBytes} bytes`
              : reason === "aborted"
                ? `${program} was stopped: ${String(abortSignal?.reason ?? "aborted")}`
                : `${program} exited with ${code ?? signal}${result.stderr ? `: ${result.stderr.slice(0, PROCESS.maxStderrBytes)}` : ""}`;
      if (logFailures) {
        const meta = { program, pid: child.pid, reason, code, signal, durationMs: Date.now() - started };
        if (reason === "exit" || reason === "aborted") logger.warn("command failed", meta);
        else logger.error("command stopped", meta);
      }
      reject(new CommandError(reason, { ...result, code, signal }, detail));
    });
  });
}

import { describe, expect, it } from "vitest";
import { CommandError, runCommand } from "./run-command";

const NODE = process.execPath;
const QUIET = { logFailures: false } as const;

/** True while a process with this pid exists (a zombie counts too, so this also proves it was reaped). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function failureOf(run: Promise<unknown>): Promise<CommandError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
}

describe("runCommand", () => {
  it("resolves with the output of a command that exits with 0", async () => {
    const result = await runCommand(NODE, ["-e", "process.stdout.write('hello')"], { timeoutMs: 10_000 });
    expect(result.stdout.toString()).toBe("hello");
    expect(alive(result.pid!)).toBe(false);
  });

  it("rejects a non-zero exit and keeps its output", async () => {
    const error = await failureOf(runCommand(NODE, ["-e", "process.stdout.write('{}'); process.stderr.write('bad'); process.exit(3)"], { timeoutMs: 10_000, ...QUIET }));
    expect(error.reason).toBe("exit");
    expect(error.result.code).toBe(3);
    expect(error.result.stdout.toString()).toBe("{}");
    expect(error.result.stderr).toBe("bad");
  });

  it("stops a command that runs past its timeout and reaps it", async () => {
    const error = await failureOf(runCommand(NODE, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200, ...QUIET }));
    expect(error.reason).toBe("timeout");
    expect(error.result.signal).toBe("SIGTERM");
    expect(alive(error.result.pid!)).toBe(false);
  });

  it("kills a command that ignores SIGTERM", async () => {
    const script = "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)";
    const error = await failureOf(runCommand(NODE, ["-e", script], { timeoutMs: 500, ...QUIET }));
    expect(error.reason).toBe("timeout");
    expect(error.result.signal).toBe("SIGKILL");
    expect(alive(error.result.pid!)).toBe(false);
  }, 10_000);

  it("stops a command when its signal aborts, also one aborted before it started", async () => {
    const controller = new AbortController();
    const running = failureOf(runCommand(NODE, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 10_000, signal: controller.signal, ...QUIET }));
    controller.abort(new Error("worker stopping"));
    const error = await running;
    expect(error.reason).toBe("aborted");
    expect(error.message).toContain("worker stopping");
    expect(error.result.signal).toBe("SIGTERM");
    expect(alive(error.result.pid!)).toBe(false);

    const early = await failureOf(runCommand(NODE, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 10_000, signal: AbortSignal.abort(), ...QUIET }));
    expect(early.reason).toBe("aborted");
    expect(alive(early.result.pid!)).toBe(false);
  });

  it("stops a command that writes more than allowed", async () => {
    const error = await failureOf(runCommand(NODE, ["-e", "setInterval(() => process.stdout.write('x'.repeat(65536)), 1)"], { timeoutMs: 10_000, maxStdoutBytes: 1024, ...QUIET }));
    expect(error.reason).toBe("output-limit");
    expect(alive(error.result.pid!)).toBe(false);
  });

  it("rejects when the program does not exist", async () => {
    const error = await failureOf(runCommand("/nonexistent/relayfiles-test", [], { timeoutMs: 1_000, ...QUIET }));
    expect(error.reason).toBe("spawn");
  });
});

import { describe, expect, it } from "vitest";
import { panelSummary, percentDone, transferMeta, type TransferProgress } from "./transfer-text";

const base: TransferProgress = { status: "active", files: 3, folders: 1, total: 3_000_000_000, done: 1_000_000_000, elapsed: 10, auto: false };

describe("transfer text (design meta)", () => {
  it("describes active, paused and finished uploads", () => {
    expect(transferMeta(base)).toBe("1 folder · 3 files · 3.0 GB · 33% · 100 MB/s");
    expect(transferMeta({ ...base, status: "paused", auto: true })).toBe("1 folder · 3 files · 3.0 GB · 33% · connection lost, resumes automatically · continues from 1.0 GB");
    expect(transferMeta({ ...base, status: "paused" })).toContain("· paused ·");
    expect(transferMeta({ ...base, folders: 0, files: 1, status: "complete", done: base.total, elapsed: 75 })).toBe("1 file · 3.0 GB · in 1:15 · uploaded");
    expect(transferMeta({ ...base, status: "error", error: "Not enough space on the server." })).toBe("1 folder · 3 files · 3.0 GB · Not enough space on the server.");
    expect(transferMeta({ ...base, folders: 0, files: 2, status: "handed", done: 0, elapsed: 0 })).toBe("2 files · 3.0 GB · saving in your browser");
  });

  it("summarizes the panel", () => {
    expect(panelSummary(2, 1)).toBe("2 active · 1 finished");
    expect(panelSummary(0, 3)).toBe("3 finished");
    expect(percentDone({ done: 0, total: 0 })).toBe(100);
  });
});

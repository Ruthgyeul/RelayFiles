import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSize, formatTime, table } from "./format.ts";

describe("formatSize", () => {
  it("uses the largest unit below 1024", () => {
    assert.equal(formatSize(512), "512 B");
    assert.equal(formatSize(1536), "1.5 KB");
    assert.equal(formatSize("5368709120"), "5.0 GB");
  });
});

describe("table", () => {
  it("pads every column but the last", () => {
    assert.equal(
      table([
        ["file", "1 B", "a"],
        ["dir ", "10 items", "Photos"],
      ]),
      "file  1 B       a\ndir   10 items  Photos",
    );
  });
});

describe("formatTime", () => {
  it("shortens ISO times and marks missing ones", () => {
    assert.equal(formatTime("2026-11-12T10:30:59.000Z"), "2026-11-12 10:30");
    assert.equal(formatTime(null), "-");
  });
});

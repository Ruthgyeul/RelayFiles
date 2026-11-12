import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeMetadata, nextChunk, retryDelayMs } from "./tus.ts";

describe("encodeMetadata", () => {
  it("joins key and base64 value pairs", () => {
    assert.equal(encodeMetadata({ batch: "abc", filename: "a b.txt" }), "batch YWJj,filename YSBiLnR4dA==");
  });
});

describe("nextChunk", () => {
  it("never goes past the end", () => {
    assert.deepEqual(nextChunk(0, 10, 4), { start: 0, length: 4 });
    assert.deepEqual(nextChunk(8, 10, 4), { start: 8, length: 2 });
    assert.deepEqual(nextChunk(0, 0, 4), { start: 0, length: 0 });
  });
});

describe("retryDelayMs", () => {
  it("doubles up to 30 seconds", () => {
    assert.equal(retryDelayMs(1), 1_000);
    assert.equal(retryDelayMs(3), 4_000);
    assert.equal(retryDelayMs(10), 30_000);
  });
});

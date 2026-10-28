import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { Throttle } from "./throttle";

describe("Throttle", () => {
  it("passes every byte through at the given rate", async () => {
    const chunks = Array.from({ length: 4 }, (_, index) => Buffer.alloc(5_000, index));
    const started = performance.now();
    const out = await buffer(Readable.from(chunks).pipe(new Throttle(100_000)));
    const elapsed = performance.now() - started;
    expect(out).toEqual(Buffer.concat(chunks));
    // 20 kB at 100 kB/s takes about 200 ms.
    expect(elapsed).toBeGreaterThanOrEqual(180);
  });
});

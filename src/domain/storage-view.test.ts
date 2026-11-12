import { describe, expect, it } from "vitest";
import { storageBars, type StorageEntry } from "./storage-view";

const entry = (name: string, bytes: number, folder = true): StorageEntry => ({ id: name, name, folder, bytes: BigInt(bytes) });

describe("storageBars", () => {
  it("lists items largest first with their share", () => {
    expect(storageBars([entry("b", 25), entry("a", 75, false)], 100n, 8)).toEqual([
      { id: "a", name: "a", folder: false, bytes: "75", percent: 75, count: 1 },
      { id: "b", name: "b", folder: true, bytes: "25", percent: 25, count: 1 },
    ]);
  });

  it("adds up the smallest items as Other", () => {
    const bars = storageBars([entry("a", 50), entry("b", 30), entry("c", 15), entry("d", 5)], 100n, 3);
    expect(bars.map((bar) => [bar.name, bar.bytes, bar.count])).toEqual([
      ["a", "50", 1],
      ["b", "30", 1],
      ["Other", "20", 2],
    ]);
    expect(bars[2]!.id).toBeNull();
  });

  it("leaves out empty items and handles an empty account", () => {
    expect(storageBars([entry("empty", 0)], 0n, 8)).toEqual([]);
  });

  it("keeps two decimals of the share for sizes beyond 2^53", () => {
    const total = 2n ** 60n;
    expect(storageBars([{ id: "x", name: "x", folder: false, bytes: total / 3n }], total, 8)[0]!.percent).toBe(33.33);
  });
});

import { describe, expect, it } from "vitest";
import { compareTrees, type DiskEntry, type TreeEntry } from "./fsck";

const file = (size: number): TreeEntry => ({ type: "file", size: BigInt(size) });
const folder: TreeEntry = { type: "folder", size: 0n };

describe("compareTrees", () => {
  it("finds nothing when both sides agree", () => {
    const tree = new Map<string, TreeEntry>([["Trip", folder], ["Trip/a.txt", file(5)]]);
    expect(compareTrees(tree, tree)).toEqual({ missing: [], orphans: [], sizeMismatch: [] });
  });

  it("lists missing files, top-level orphans and size differences", () => {
    const db = new Map<string, TreeEntry>([["Trip", folder], ["Trip/a.txt", file(5)], ["Trip/b.txt", file(3)], ["c.txt", file(1)]]);
    const disk = new Map<string, DiskEntry>([
      ["Trip", folder],
      ["Trip/a.txt", file(9)],
      ["Leftover", folder],
      ["Leftover/x.bin", file(1)],
      ["Leftover/Deep", folder],
      ["link", { type: "other", size: 0n }],
      ["c.txt", folder],
    ]);
    expect(compareTrees(db, disk)).toEqual({
      missing: ["Trip/b.txt", "c.txt"],
      orphans: ["Leftover", "c.txt", "link"],
      sizeMismatch: ["Trip/a.txt"],
    });
  });
});

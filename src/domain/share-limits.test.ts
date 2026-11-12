import { describe, expect, it } from "vitest";
import { downloadsUsedUp, limitingFoldersBelow, limitingIds, limitsDownloads, ranOutWith, type TreeLimitRow } from "./share-limits";

const row = (id: string, parentId: string | null, settings: Partial<TreeLimitRow> = {}): TreeLimitRow => ({ id, parentId, burn: false, downloadLimit: null, downloads: 0, ...settings });

describe("limitsDownloads / downloadsUsedUp", () => {
  it("knows download limits and delete after the first download", () => {
    expect(limitsDownloads(row("a", null))).toBe(false);
    expect(limitsDownloads(row("a", null, { downloadLimit: 0 }))).toBe(false);
    expect(limitsDownloads(row("a", null, { downloadLimit: 2 }))).toBe(true);
    expect(limitsDownloads(row("a", null, { burn: true }))).toBe(true);
    expect(downloadsUsedUp(row("a", null, { downloadLimit: 2, downloads: 1 }))).toBe(false);
    expect(downloadsUsedUp(row("a", null, { downloadLimit: 2, downloads: 2 }))).toBe(true);
    expect(downloadsUsedUp(row("a", null, { burn: true, downloads: 1 }))).toBe(true);
    expect(downloadsUsedUp(row("a", null, { downloads: 50 }))).toBe(false);
  });

  it("lists the limiting items", () => {
    expect(limitingIds([row("a", null), row("b", null, { downloadLimit: 1 }), row("c", null, { burn: true })])).toEqual(["b", "c"]);
  });
});

describe("limitingFoldersBelow", () => {
  // top / inner(limit 1) / deep / file1 ; top / file2 ; top / other(burn) / file3
  const tree = [
    row("top", "root", { downloadLimit: 5 }),
    row("inner", "top", { downloadLimit: 1 }),
    row("deep", "inner"),
    row("file1", "deep"),
    row("file2", "top"),
    row("other", "top", { burn: true }),
    row("file3", "other"),
  ];

  it("finds the limiting folders between the top and each item, not the top itself", () => {
    const below = limitingFoldersBelow(tree, "top");
    expect(below.get("file1")!.map((folder) => folder.id)).toEqual(["inner"]);
    expect(below.get("file2")).toEqual([]);
    expect(below.get("file3")!.map((folder) => folder.id)).toEqual(["other"]);
    expect(below.get("inner")).toEqual([]);
    expect(below.has("top")).toBe(false);
  });

  it("nests limits from the nearest folder up", () => {
    const nested = [row("top", null), row("a", "top", { burn: true }), row("b", "a", { downloadLimit: 3 }), row("f", "b")];
    expect(limitingFoldersBelow(nested, "top").get("f")!.map((folder) => folder.id)).toEqual(["b", "a"]);
  });
});

describe("ranOutWith", () => {
  it("answers only for the download that used the item up", () => {
    expect(ranOutWith({ burn: false, downloadLimit: 3, downloads: 2 })).toBeNull();
    expect(ranOutWith({ burn: false, downloadLimit: 3, downloads: 3 })).toBe("limit");
    expect(ranOutWith({ burn: false, downloadLimit: 3, downloads: 4 })).toBeNull();
    expect(ranOutWith({ burn: true, downloadLimit: null, downloads: 1 })).toBe("burn");
    expect(ranOutWith({ burn: true, downloadLimit: 5, downloads: 1 })).toBe("burn");
    expect(ranOutWith({ burn: false, downloadLimit: null, downloads: 9 })).toBeNull();
    expect(ranOutWith({ burn: false, downloadLimit: 0, downloads: 0 })).toBeNull();
  });
});

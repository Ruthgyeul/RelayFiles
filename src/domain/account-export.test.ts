import { describe, expect, it } from "vitest";
import { compareExportPaths, exportFileName, favoriteFolderPaths } from "./account-export";

describe("exportFileName", () => {
  it("keeps safe characters of the account name and the UTC date", () => {
    expect(exportFileName("anon-h2wcgy", new Date("2026-11-12T23:30:00Z"))).toBe("relayfiles-anon-h2wcgy-20261112.tar");
    expect(exportFileName("Jae Ah / 재아", new Date("2026-01-02T00:00:00Z"))).toBe("relayfiles-Jae-Ah-20260102.tar");
  });

  it("falls back when nothing safe is left", () => {
    expect(exportFileName("재아", new Date("2026-01-02T00:00:00Z"))).toBe("relayfiles-account-20260102.tar");
  });
});

describe("favoriteFolderPaths", () => {
  it("gives each folder its names from the top", () => {
    const paths = favoriteFolderPaths([
      { id: "a", parentId: null, name: "Work" },
      { id: "b", parentId: "a", name: "2026" },
      { id: "c", parentId: "b", name: "Q4" },
    ]);
    expect(paths.get("a")).toEqual(["Work"]);
    expect(paths.get("c")).toEqual(["Work", "2026", "Q4"]);
  });

  it("leaves out folders in a loop or under a missing parent", () => {
    const paths = favoriteFolderPaths([
      { id: "x", parentId: "y", name: "X" },
      { id: "y", parentId: "x", name: "Y" },
      { id: "z", parentId: "gone", name: "Z" },
    ]);
    expect(paths.size).toBe(0);
  });
});

describe("compareExportPaths", () => {
  it("puts a folder before what is inside and orders names by code unit", () => {
    const paths = [["b.txt"], ["Docs", "a.txt"], ["Docs"], ["Docs", "Inner", "z"], ["Docs", "B"]];
    expect([...paths].sort(compareExportPaths)).toEqual([["Docs"], ["Docs", "B"], ["Docs", "Inner", "z"], ["Docs", "a.txt"], ["b.txt"]]);
  });

  it("is 0 for the same path", () => {
    expect(compareExportPaths(["a", "b"], ["a", "b"])).toBe(0);
  });
});

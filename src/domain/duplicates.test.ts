import { describe, expect, it } from "vitest";
import { defaultDuplicateSelection, fullySelectedGroups, groupDuplicates, type DuplicateCandidate } from "./duplicates";

const file = (id: string, sha256: string | null, size: number, createdAt: number): DuplicateCandidate => ({ id, sha256, size, createdAt });

describe("groupDuplicates", () => {
  it("groups same content regardless of name, oldest first, biggest waste first", () => {
    const { groups, unchecked } = groupDuplicates([
      file("a", "h1", 10, 3),
      file("b", "h1", 10, 1),
      file("c", "h2", 100, 1),
      file("d", "h2", 100, 2),
      file("e", "h3", 5, 1),
      file("f", null, 10, 1),
    ]);
    expect(unchecked).toBe(1);
    expect(groups.map((group) => group.files.map((f) => f.id))).toEqual([
      ["c", "d"],
      ["b", "a"],
    ]);
    expect(groups[0]!.wasted).toBe(100);
  });

  it("does not group the same hash with a different size", () => {
    expect(groupDuplicates([file("a", "h", 1, 1), file("b", "h", 2, 1)]).groups).toEqual([]);
  });

  it("counts three copies as two wasted", () => {
    const { groups } = groupDuplicates([file("a", "h", 7, 1), file("b", "h", 7, 2), file("c", "h", 7, 3)]);
    expect(groups[0]!.wasted).toBe(14);
  });
});

describe("selection helpers", () => {
  const { groups } = groupDuplicates([file("a", "h", 1, 1), file("b", "h", 1, 2), file("c", "h", 1, 3), file("x", "k", 2, 1), file("y", "k", 2, 2)]);

  it("selects every copy but the oldest", () => {
    expect(defaultDuplicateSelection(groups).sort()).toEqual(["b", "c", "y"]);
  });

  it("finds groups that would lose every copy", () => {
    expect(fullySelectedGroups(groups, new Set(["a", "b", "c", "y"])).map((group) => group.sha256)).toEqual(["h"]);
    expect(fullySelectedGroups(groups, new Set(["b", "y"]))).toEqual([]);
  });
});

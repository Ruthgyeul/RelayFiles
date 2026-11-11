import { describe, expect, it } from "vitest";
import { favoriteDepth, favoriteHeight, favoritePath, favoriteSubtree, favoriteTree, fitsDepth, liftedNames, wouldCycle } from "./favorites";

// a ─ b ─ c,  a ─ d,  e
const tree = favoriteTree([
  { id: "a", parentId: null, name: "Work" },
  { id: "b", parentId: "a", name: "2026" },
  { id: "c", parentId: "b", name: "Q1" },
  { id: "d", parentId: "a", name: "Old" },
  { id: "e", parentId: null, name: "Music" },
]);

describe("favorite folder tree", () => {
  it("builds paths and depths from the top of Favorites", () => {
    expect(favoritePath(tree, "c").map((folder) => folder.name)).toEqual(["Work", "2026", "Q1"]);
    expect(favoritePath(tree, null)).toEqual([]);
    expect(favoritePath(tree, "missing")).toEqual([]);
    expect(favoriteDepth(tree, null)).toBe(0);
    expect(favoriteDepth(tree, "e")).toBe(1);
    expect(favoriteDepth(tree, "c")).toBe(3);
  });

  it("lists a subtree and its height", () => {
    expect(favoriteSubtree(tree, "a").sort()).toEqual(["a", "b", "c", "d"]);
    expect(favoriteSubtree(tree, "e")).toEqual(["e"]);
    expect(favoriteHeight(tree, "a")).toBe(2);
    expect(favoriteHeight(tree, "c")).toBe(0);
  });

  it("refuses moves into the folder itself or below it", () => {
    expect(wouldCycle(tree, "a", "a")).toBe(true);
    expect(wouldCycle(tree, "a", "c")).toBe(true);
    expect(wouldCycle(tree, "b", "d")).toBe(false);
    expect(wouldCycle(tree, "b", null)).toBe(false);
  });

  it("checks the depth a move would reach", () => {
    expect(fitsDepth(tree, "a", "e", 4)).toBe(true); // e(1) + a(1) + 2 below = 4
    expect(fitsDepth(tree, "a", "e", 3)).toBe(false);
    expect(fitsDepth(tree, "c", null, 1)).toBe(true);
  });

  it("renames lifted folders whose names are taken", () => {
    const names = liftedNames(["Music", "Old"], [
      { id: "x", parentId: "p", name: "Old" },
      { id: "y", parentId: "p", name: "Old" },
      { id: "z", parentId: "p", name: "New" },
    ]);
    expect([...names.entries()]).toEqual([
      ["x", "Old (2)"],
      ["y", "Old (3)"],
      ["z", "New"],
    ]);
  });
});

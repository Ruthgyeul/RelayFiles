import { describe, expect, it } from "vitest";
import {
  FAVORITE_SORT_KEYS,
  FAVORITE_SORT_OPTION_LABEL,
  FAVORITE_SORT_SHORT_LABEL,
  favoriteDepth,
  favoriteHeight,
  favoritePath,
  favoriteSubtree,
  favoriteTree,
  fitsDepth,
  liftedNames,
  sortFavorites,
  visibleFavoriteFolders,
  wouldCycle,
} from "./favorites";
import type { SortableNode } from "./tree";

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

describe("favorites listing", () => {
  const node = (name: string, extra: Partial<SortableNode> = {}): SortableNode => ({ type: "file", name, kind: "other", size: 0, createdAt: 0, ...extra });
  // As the server lists them: newest favorite first.
  const added = [node("b.txt", { createdAt: 1, size: 3 }), node("Docs", { type: "folder", kind: null, createdAt: 3 }), node("a.txt", { createdAt: 2, size: 9 })];
  const names = (list: readonly { name: string }[]) => list.map((entry) => entry.name);

  it("keeps the added order or sorts like the File Manager", () => {
    expect(names(sortFavorites(added, "added"))).toEqual(["b.txt", "Docs", "a.txt"]);
    expect(names(sortFavorites(added, "name"))).toEqual(["Docs", "a.txt", "b.txt"]);
    expect(names(sortFavorites(added, "date"))).toEqual(["Docs", "a.txt", "b.txt"]);
    expect(names(sortFavorites(added, "date-asc"))).toEqual(["Docs", "b.txt", "a.txt"]);
    expect(names(sortFavorites(added, "size"))).toEqual(["Docs", "a.txt", "b.txt"]);
  });

  it("labels every sort key", () => {
    expect(FAVORITE_SORT_KEYS[0]).toBe("added");
    for (const key of FAVORITE_SORT_KEYS) {
      expect(FAVORITE_SORT_OPTION_LABEL[key]).toBeTruthy();
      expect(FAVORITE_SORT_SHORT_LABEL[key]).toBeTruthy();
    }
    expect(FAVORITE_SORT_OPTION_LABEL.added).toBe("Recently added");
  });

  const folders = [{ name: "Work 10" }, { name: "music" }, { name: "Work 2" }];
  const listing = { query: "", filter: "all", tagMode: false, sort: "added" } as const;

  it("lists organizing folders by name, reversed only for Name Z to A", () => {
    expect(names(visibleFavoriteFolders(folders, listing))).toEqual(["music", "Work 2", "Work 10"]);
    expect(names(visibleFavoriteFolders(folders, { ...listing, sort: "date" }))).toEqual(["music", "Work 2", "Work 10"]);
    expect(names(visibleFavoriteFolders(folders, { ...listing, sort: "name-desc" }))).toEqual(["Work 10", "Work 2", "music"]);
  });

  it("matches folders by name and hides them for tag search and file types", () => {
    expect(names(visibleFavoriteFolders(folders, { ...listing, query: "work" }))).toEqual(["Work 2", "Work 10"]);
    expect(names(visibleFavoriteFolders(folders, { ...listing, filter: "folder" }))).toHaveLength(3);
    expect(visibleFavoriteFolders(folders, { ...listing, filter: "video" })).toEqual([]);
    expect(visibleFavoriteFolders(folders, { ...listing, tagMode: true })).toEqual([]);
  });
});

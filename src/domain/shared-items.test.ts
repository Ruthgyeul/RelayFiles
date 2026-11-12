import { describe, expect, it } from "vitest";
import { isListedShare, matchesSharedFilter, visibilityInside, type ShareFolder } from "./shared-items";

const folders = new Map<string, ShareFolder>([
  ["root", { parentId: null, visibility: "private" }],
  ["pub", { parentId: "root", visibility: "public" }],
  ["inner", { parentId: "pub", visibility: "inherit" }],
  ["closed", { parentId: "pub", visibility: "private" }],
]);

describe("visibilityInside", () => {
  it("takes the nearest explicit setting up the chain", () => {
    expect(visibilityInside("root", folders)).toBe("private");
    expect(visibilityInside("inner", folders)).toBe("public");
    expect(visibilityInside("closed", folders)).toBe("private");
  });

  it("is private above the root and for unknown or looping folders", () => {
    expect(visibilityInside(null, folders)).toBe("private");
    expect(visibilityInside("missing", folders)).toBe("private");
    const loop = new Map<string, ShareFolder>([
      ["a", { parentId: "b", visibility: "inherit" }],
      ["b", { parentId: "a", visibility: "inherit" }],
    ]);
    expect(visibilityInside("a", loop)).toBe("private");
  });
});

describe("isListedShare", () => {
  it("lists the top of a public part of the tree", () => {
    expect(isListedShare({ visibility: "public", restricted: false }, "private")).toBe(true);
  });

  it("leaves items that are public through a folder above to that folder", () => {
    expect(isListedShare({ visibility: "inherit", restricted: false }, "public")).toBe(false);
    expect(isListedShare({ visibility: "public", restricted: false }, "public")).toBe(false);
  });

  it("lists public items with limits of their own", () => {
    expect(isListedShare({ visibility: "inherit", restricted: true }, "public")).toBe(true);
    expect(isListedShare({ visibility: "public", restricted: true }, "public")).toBe(true);
  });

  it("never lists what nobody can open", () => {
    expect(isListedShare({ visibility: "private", restricted: true }, "public")).toBe(false);
    expect(isListedShare({ visibility: "inherit", restricted: true }, "private")).toBe(false);
  });
});

describe("matchesSharedFilter", () => {
  const plain = { hasPassword: false, downloadLimit: null, burn: false, expAt: null, dlPaused: false };

  it("matches each chip to its setting", () => {
    expect(matchesSharedFilter(plain, "all")).toBe(true);
    expect(matchesSharedFilter(plain, "password")).toBe(false);
    expect(matchesSharedFilter({ ...plain, hasPassword: true }, "password")).toBe(true);
    expect(matchesSharedFilter({ ...plain, downloadLimit: 3 }, "limited")).toBe(true);
    expect(matchesSharedFilter({ ...plain, burn: true }, "limited")).toBe(true);
    expect(matchesSharedFilter({ ...plain, expAt: "2026-12-01T00:00:00.000Z" }, "expiring")).toBe(true);
    expect(matchesSharedFilter({ ...plain, dlPaused: true }, "paused")).toBe(true);
    expect(matchesSharedFilter(plain, "paused")).toBe(false);
  });
});

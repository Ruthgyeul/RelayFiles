import { describe, expect, it } from "vitest";
import { MAX_NAME_BYTES, nameError, splitExtension, uniqName } from "./names";

describe("nameError (design messages)", () => {
  it.each([
    ["", "Name can't be empty."],
    [".", '"." is reserved by the file system.'],
    ["..", '".." is reserved by the file system.'],
    ["a/b", 'Name can\'t contain "/".'],
    ["a\0b", "Name can't contain null characters."],
    [" lead", "Name can't start or end with a space."],
    ["trail ", "Name can't start or end with a space."],
  ])("%j → %s", (name, message) => {
    expect(nameError(name)).toBe(message);
  });

  it("accepts normal names, dotfiles and Hangul", () => {
    for (const name of ["movie.mp4", ".env", "Upload Oct 5, 3:12 PM", "한글 폴더", "a..b"]) expect(nameError(name)).toBe("");
  });

  it("limits names to 255 UTF-8 bytes", () => {
    expect(nameError("a".repeat(MAX_NAME_BYTES))).toBe("");
    expect(nameError("a".repeat(256))).toBe("Name is too long (256 / 255 bytes).");
    // Hangul syllables are 3 bytes each.
    expect(nameError("가".repeat(85))).toBe("");
    expect(nameError("가".repeat(86))).toBe("Name is too long (258 / 255 bytes).");
  });
});

describe("splitExtension", () => {
  it("splits files but not folders", () => {
    expect(splitExtension("movie.final.mp4", true)).toEqual(["movie.final", ".mp4"]);
    expect(splitExtension("archive", true)).toEqual(["archive", ""]);
    expect(splitExtension("photos.2024", false)).toEqual(["photos.2024", ""]);
  });
});

describe("uniqName (design behaviour)", () => {
  it("keeps a free name", () => {
    expect(uniqName(["a.mp4"], "b.mp4", true)).toBe("b.mp4");
  });

  it("numbers files before the extension and folders at the end", () => {
    expect(uniqName(["a.mp4"], "a.mp4", true)).toBe("a (2).mp4");
    expect(uniqName(["a.mp4", "a (2).mp4"], "a.mp4", true)).toBe("a (3).mp4");
    expect(uniqName(["New folder"], "New folder", false)).toBe("New folder (2)");
  });

  it("replaces an existing (n) suffix instead of stacking", () => {
    expect(uniqName(["a (2).mp4", "a.mp4"], "a (2).mp4", true)).toBe("a (3).mp4");
  });
});

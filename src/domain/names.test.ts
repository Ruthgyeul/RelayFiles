import { describe, expect, it } from "vitest";
import { MAX_NAME_BYTES, nameError, splitExtension, uniqName, utf8Prefix } from "./names";

describe("nameError (design messages)", () => {
  it.each([
    ["", "Name can't be empty."],
    [".", '"." is reserved by the file system.'],
    ["..", '".." is reserved by the file system.'],
    ["a/b", 'Name can\'t contain "/".'],
    ["a\0b", "Name can't contain control characters."],
    ["line\nbreak", "Name can't contain control characters."],
    ["tab\there", "Name can't contain control characters."],
    ["c1\u0085", "Name can't contain control characters."],
    ["invoice\u202Efdp.exe", "Name can't contain text direction marks."],
    ["isolate\u2066x\u2069", "Name can't contain text direction marks."],
    [" lead", "Name can't start or end with a space."],
    ["trail ", "Name can't start or end with a space."],
  ])("%j → %s", (name, message) => {
    expect(nameError(name)).toBe(message);
  });

  it("accepts normal names, dotfiles and Hangul", () => {
    for (const name of ["movie.mp4", ".env", "Upload Oct 5, 3:12 PM", "한글 폴더", "a..b", "مرحبا.txt", "emoji\u200d-free"]) expect(nameError(name)).toBe("");
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

describe("utf8Prefix", () => {
  it("keeps text that fits", () => {
    expect(utf8Prefix("photo.jpg", 255)).toBe("photo.jpg");
  });

  it("cuts by bytes, never inside a character", () => {
    // "한" is 3 bytes in UTF-8, the emoji-free astral "𝒜" is 4 (a surrogate pair in JS).
    expect(utf8Prefix("한한한", 7)).toBe("한한");
    expect(utf8Prefix("a𝒜b", 4)).toBe("a");
    expect(utf8Prefix("a𝒜b", 5)).toBe("a𝒜");
    expect(utf8Prefix("abc", 0)).toBe("");
  });

  it("fills the limit with long names", () => {
    const cut = utf8Prefix("가".repeat(200), MAX_NAME_BYTES - 50);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(MAX_NAME_BYTES - 50);
    expect(new TextEncoder().encode(cut).length).toBeGreaterThan(MAX_NAME_BYTES - 53);
  });
});

describe("uniqName near the length limit", () => {
  it("shortens the base so a variant still fits in one path segment", () => {
    const long = `${"가".repeat(83)}.mp4`; // 249 + 4 = 253 bytes
    const name = uniqName([long], long, true);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(name.endsWith(" (2).mp4")).toBe(true);
    expect(nameError(name)).toBe("");
  });
});

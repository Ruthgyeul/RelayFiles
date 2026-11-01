import { describe, expect, it } from "vitest";
import { canSlideshow, firstSlideIndex, nextSlideIndex } from "./slideshow";

const items = [{ kind: "video" }, { kind: "image" }, { kind: "other" }, { kind: "image" }, { kind: "audio" }];

describe("nextSlideIndex", () => {
  it("skips to the next picture and stops at the end", () => {
    expect(nextSlideIndex(items, 1)).toBe(3);
    expect(nextSlideIndex(items, 3)).toBeNull();
    expect(nextSlideIndex([], 0)).toBeNull();
  });
});

describe("firstSlideIndex", () => {
  it("finds the first picture", () => {
    expect(firstSlideIndex(items)).toBe(1);
    expect(firstSlideIndex([{ kind: "video" }])).toBeNull();
  });
});

describe("canSlideshow", () => {
  it("needs a picture open and another picture", () => {
    expect(canSlideshow(items, 1)).toBe(true);
    expect(canSlideshow(items, 0)).toBe(false);
    expect(canSlideshow([{ kind: "image" }, { kind: "video" }], 0)).toBe(false);
    expect(canSlideshow(items, 9)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { gridNavIndex, isListNavKey, listNavIndex } from "./list-nav";

describe("listNavIndex", () => {
  it("steps through rows with up and down, staying inside the list", () => {
    expect(listNavIndex(0, "ArrowDown", 3, "list")).toBe(1);
    expect(listNavIndex(2, "ArrowDown", 3, "list")).toBe(2);
    expect(listNavIndex(0, "ArrowUp", 3, "list")).toBe(0);
    expect(listNavIndex(1, "ArrowLeft", 3, "list")).toBeNull();
  });
  it("steps through cards with left and right; up and down follow columns", () => {
    expect(listNavIndex(1, "ArrowRight", 4, "grid")).toBe(2);
    expect(listNavIndex(1, "ArrowLeft", 4, "grid")).toBe(0);
    expect(listNavIndex(1, "ArrowDown", 4, "grid")).toBeNull();
  });
  it("jumps to the ends", () => {
    expect(listNavIndex(2, "Home", 5, "grid")).toBe(0);
    expect(listNavIndex(2, "End", 5, "list")).toBe(4);
    expect(listNavIndex(0, "End", 0, "list")).toBeNull();
  });
  it("knows its keys", () => {
    expect(isListNavKey("Home")).toBe(true);
    expect(isListNavKey("Enter")).toBe(false);
  });
});

describe("gridNavIndex", () => {
  // Three columns at 0, 170, 340; two full rows and one card in the last.
  const boxes = [0, 170, 340, 0, 170, 340, 0].map((left, index) => ({ left, top: Math.floor(index / 3) * 220 + 0.4 }));
  it("moves to the same column in the next or previous row", () => {
    expect(gridNavIndex(boxes, 1, "ArrowDown")).toBe(4);
    expect(gridNavIndex(boxes, 4, "ArrowUp")).toBe(1);
  });
  it("takes the closest card of a shorter row", () => {
    expect(gridNavIndex(boxes, 5, "ArrowDown")).toBe(6);
  });
  it("stops at the top and bottom rows", () => {
    expect(gridNavIndex(boxes, 2, "ArrowUp")).toBeNull();
    expect(gridNavIndex(boxes, 6, "ArrowDown")).toBeNull();
    expect(gridNavIndex(boxes, 9, "ArrowDown")).toBeNull();
  });
});

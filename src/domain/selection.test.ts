import { describe, expect, it } from "vitest";
import { rangeBetween } from "./selection";

const IDS = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("selects from the anchor down to the target", () => {
    expect(rangeBetween(IDS, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("selects upward too", () => {
    expect(rangeBetween(IDS, "d", "a")).toEqual(["a", "b", "c", "d"]);
  });

  it("is the target alone without an anchor, or when the anchor left the list", () => {
    expect(rangeBetween(IDS, null, "c")).toEqual(["c"]);
    expect(rangeBetween(IDS, "gone", "c")).toEqual(["c"]);
  });

  it("is empty for a target that is not listed", () => {
    expect(rangeBetween(IDS, "a", "gone")).toEqual([]);
  });
});

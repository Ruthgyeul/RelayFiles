import { describe, expect, it } from "vitest";
import { hasAllTags, normalizeTag, parseTags } from "./tags";

describe("tags", () => {
  it("parses tag queries like the design", () => {
    expect(parseTags("#Movie #2024, #work")).toEqual(["movie", "2024", "work"]);
    expect(parseTags("#")).toEqual([]);
    expect(parseTags("plain text")).toEqual([]);
  });

  it("requires every wanted tag", () => {
    expect(hasAllTags(["a", "b"], ["a"])).toBe(true);
    expect(hasAllTags(["a"], ["a", "b"])).toBe(false);
    expect(hasAllTags(["a"], [])).toBe(false);
  });

  it("normalizes typed tags", () => {
    expect(normalizeTag("  #Road Trip ")).toBe("road-trip");
    expect(normalizeTag("a,b#c")).toBe("abc");
    expect(normalizeTag("x".repeat(40))).toHaveLength(24);
  });
});

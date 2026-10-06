import { describe, expect, it } from "vitest";
import { moveHighlight, parseSearchQuery, rankByName, searchHeading } from "./search";

describe("global search", () => {
  it("reads the query like the design", () => {
    expect(parseSearchQuery("  ")).toEqual({ mode: "recent" });
    expect(parseSearchQuery("#Movie #2024")).toEqual({ mode: "tags", tags: ["movie", "2024"] });
    expect(parseSearchQuery("#")).toEqual({ mode: "recent" });
    expect(parseSearchQuery(" Trip ")).toEqual({ mode: "name", text: "trip" });
  });

  it("ranks earlier matches, then folders, then names", () => {
    const items = [
      { name: "My trip.mp4", type: "file" as const },
      { name: "trip notes.txt", type: "file" as const },
      { name: "Trips", type: "folder" as const },
      { name: "Other", type: "file" as const },
    ];
    expect(rankByName(items, "trip").map((item) => item.name)).toEqual(["Trips", "trip notes.txt", "My trip.mp4"]);
  });

  it("titles the results", () => {
    expect(searchHeading({ mode: "recent" }, 8)).toBe("Recent files · type #tag (or #tag1 #tag2) to search tags");
    expect(searchHeading({ mode: "name", text: "a" }, 1)).toBe("1 result");
    expect(searchHeading({ mode: "tags", tags: ["movie", "2024"] }, 3)).toBe("3 results with #movie + #2024");
  });

  it("keeps the highlight inside the list", () => {
    expect(moveHighlight(0, "ArrowUp", 3)).toBe(0);
    expect(moveHighlight(2, "ArrowDown", 3)).toBe(2);
    expect(moveHighlight(1, "ArrowDown", 3)).toBe(2);
    expect(moveHighlight(4, "ArrowDown", 0)).toBe(0);
  });
});

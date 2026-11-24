import { describe, expect, it } from "vitest";
import { formatSearchQuery, moveHighlight, parseSearchQuery, rankByName, searchHeading } from "./search";

const search = (parts: Partial<Extract<ReturnType<typeof parseSearchQuery>, { mode: "search" }>>) => ({ mode: "search" as const, text: "", tags: [], kinds: [], newerThanDays: null, olderThanDays: null, ...parts });

describe("global search", () => {
  it("reads the query like the design", () => {
    expect(parseSearchQuery("  ")).toEqual({ mode: "recent" });
    expect(parseSearchQuery("#Movie #2024")).toEqual(search({ tags: ["movie", "2024"] }));
    expect(parseSearchQuery("#")).toEqual({ mode: "recent" });
    expect(parseSearchQuery(" Trip ")).toEqual(search({ text: "trip" }));
  });

  it("reads kinds, ages, tags and words together", () => {
    expect(parseSearchQuery("Beach  #trip type:image type:VIDEO newer:2w day")).toEqual(search({ text: "beach day", tags: ["trip"], kinds: ["image", "video"], newerThanDays: 14 }));
    expect(parseSearchQuery("older:1y type:folder")).toEqual(search({ kinds: ["folder"], olderThanDays: 365 }));
    expect(parseSearchQuery("newer:6m")).toEqual(search({ newerThanDays: 180 }));
    // Anything that is not a known filter is part of the name.
    expect(parseSearchQuery("type:pdf newer:soon")).toEqual(search({ text: "type:pdf newer:soon" }));
  });

  it("writes a query back in one form", () => {
    expect(formatSearchQuery(parseSearchQuery("  Beach type:image #trip newer:2w  "))).toBe("#trip type:image newer:14d beach");
    expect(formatSearchQuery(parseSearchQuery(""))).toBe("");
    const again = formatSearchQuery(parseSearchQuery("older:30d #a #a x"));
    expect(formatSearchQuery(parseSearchQuery(again))).toBe(again);
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
    expect(searchHeading(search({ text: "a" }), 1)).toBe("1 result");
    expect(searchHeading(search({ tags: ["movie", "2024"] }), 3)).toBe("3 results with #movie + #2024");
    expect(searchHeading(search({ kinds: ["video", "image"], newerThanDays: 30 }), 2)).toBe("2 results · videos or images · modified in the last 30 days");
    expect(searchHeading(search({ olderThanDays: 1 }), 0)).toBe("0 results · modified over 1 day ago");
  });

  it("keeps the highlight inside the list", () => {
    expect(moveHighlight(0, "ArrowUp", 3)).toBe(0);
    expect(moveHighlight(2, "ArrowDown", 3)).toBe(2);
    expect(moveHighlight(1, "ArrowDown", 3)).toBe(2);
    expect(moveHighlight(4, "ArrowDown", 0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { decodeTimelineCursor, encodeTimelineCursor, groupByMonth } from "./timeline";

describe("timeline cursor", () => {
  it("round-trips a position", () => {
    const position = { at: 1_730_000_000_000, id: "abcdefghjkmn" };
    expect(decodeTimelineCursor(encodeTimelineCursor(position))).toEqual(position);
  });

  it("refuses what it did not make", () => {
    for (const cursor of ["", "abc", "12.", ".abcdefghjkmn", "12.ABCDEFGHJKMN", "99999999999999999.abcdefghjkmn", "1.2.abcdefghjkmn"]) expect(decodeTimelineCursor(cursor), cursor).toBeNull();
  });
});

describe("groupByMonth", () => {
  const item = (date: string) => ({ date });

  it("groups consecutive items of one month, newest first, with the month's name", () => {
    const groups = groupByMonth([item("2026-11-13T10:00:00Z"), item("2026-11-01T10:00:00Z"), item("2026-10-31T10:00:00Z")], "UTC");
    expect(groups.map((group) => [group.key, group.label, group.items.length])).toEqual([
      ["2026-11", "November 2026", 2],
      ["2026-10", "October 2026", 1],
    ]);
  });

  it("uses the viewer's time zone for the month", () => {
    // 2026-10-31 20:00 UTC is already November 1 in Seoul.
    expect(groupByMonth([item("2026-10-31T20:00:00Z")], "Asia/Seoul")[0]?.key).toBe("2026-11");
    expect(groupByMonth([item("2026-10-31T20:00:00Z")], "UTC")[0]?.key).toBe("2026-10");
  });

  it("keeps an empty list empty", () => {
    expect(groupByMonth([], "UTC")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { cleanAgeText, cleanCutoff, cleanDateOf, cleanPreviewText, cleanRuleText, cleanTagLabel, isDueForClean } from "./auto-clean";

const now = new Date("2026-11-24T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("cleanCutoff", () => {
  it("is the given number of days before now", () => {
    expect(cleanCutoff(30, now).toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });
});

describe("cleanDateOf", () => {
  it("uses the date added for created rules", () => {
    expect(cleanDateOf({ createdAt: daysAgo(1), modifiedAt: daysAgo(100) }, "created")).toEqual(daysAgo(1));
  });
  it("uses the date modified, or the date added without one", () => {
    expect(cleanDateOf({ createdAt: daysAgo(1), modifiedAt: daysAgo(100) }, "modified")).toEqual(daysAgo(100));
    expect(cleanDateOf({ createdAt: daysAgo(5), modifiedAt: null }, "modified")).toEqual(daysAgo(5));
  });
});

describe("isDueForClean", () => {
  const rule = { olderThanDays: 30, basis: "modified" as const };
  it("moves files older than the rule", () => {
    expect(isDueForClean({ createdAt: daysAgo(2), modifiedAt: daysAgo(31) }, rule, now)).toBe(true);
  });
  it("keeps files at or under the age", () => {
    expect(isDueForClean({ createdAt: daysAgo(40), modifiedAt: daysAgo(30) }, rule, now)).toBe(false);
    expect(isDueForClean({ createdAt: daysAgo(29), modifiedAt: null }, rule, now)).toBe(false);
  });
  it("reads the date added for created rules", () => {
    expect(isDueForClean({ createdAt: daysAgo(31), modifiedAt: daysAgo(1) }, { ...rule, basis: "created" }, now)).toBe(true);
  });
});

describe("texts", () => {
  it("names the age", () => {
    expect(cleanAgeText(1)).toBe("1 day");
    expect(cleanAgeText(30)).toBe("30 days");
    expect(cleanTagLabel({ olderThanDays: 7, basis: "created" })).toBe("Auto clean · 7 days");
  });
  it("describes the rule", () => {
    expect(cleanRuleText({ olderThanDays: 30, basis: "created" })).toBe("Files directly in this folder added more than 30 days ago move to Recently deleted every day.");
    expect(cleanRuleText({ olderThanDays: 90, basis: "modified" })).toContain("modified more than 90 days ago");
  });
  it("counts the files a rule would move now", () => {
    expect(cleanPreviewText(0, 5)).toBe("No files would move now.");
    expect(cleanPreviewText(1, 5)).toBe("1 file would move now.");
    expect(cleanPreviewText(5, 5)).toBe("5 files would move now.");
  });
  it("says when one run takes only part of them", () => {
    expect(cleanPreviewText(12, 5)).toBe("12 files are due: 5 files move today, the rest on the next days.");
  });
});

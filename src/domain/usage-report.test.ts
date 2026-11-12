import { describe, expect, it } from "vitest";
import { fillMonths, monthsOf, rangeEndingToday, reportRange, sortUsage, usageCsvName, usageCsvRows, type UsageRowValues } from "./usage-report";

const LIMITS = { defaultDays: 30, maxDays: 366 };
const NOW = Date.parse("2026-11-12T15:00:00Z");

describe("reportRange", () => {
  it("defaults to the last 30 days including today", () => {
    expect(reportRange({}, NOW, LIMITS)).toEqual({ from: "2026-10-14", to: "2026-11-12", days: 30 });
  });

  it("counts both ends", () => {
    expect(reportRange({ from: "2026-11-01", to: "2026-11-01" }, NOW, LIMITS)).toEqual({ from: "2026-11-01", to: "2026-11-01", days: 1 });
  });

  it("starts the default range before a given end", () => {
    expect(reportRange({ to: "2026-01-30" }, NOW, LIMITS)).toMatchObject({ from: "2026-01-01", days: 30 });
  });

  it("refuses reversed and too long ranges", () => {
    expect(reportRange({ from: "2026-11-02", to: "2026-11-01" }, NOW, LIMITS)).toEqual({ error: "The range ends before it starts." });
    expect(reportRange({ from: "2025-01-01", to: "2026-01-02" }, NOW, LIMITS)).toEqual({ error: "A report covers at most 366 days." });
    expect(reportRange({ from: "2025-01-02", to: "2026-01-02" }, NOW, LIMITS)).toMatchObject({ days: 366 });
  });
});

describe("rangeEndingToday", () => {
  it("covers the given number of days", () => {
    expect(rangeEndingToday(90, NOW)).toEqual({ from: "2026-08-15", to: "2026-11-12" });
  });
});

describe("months", () => {
  it("lists every month the range touches, across a year end", () => {
    expect(monthsOf({ from: "2025-11-20", to: "2026-02-01" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsOf({ from: "2026-11-01", to: "2026-11-12" })).toEqual(["2026-11"]);
  });

  it("fills months without traffic with 0", () => {
    expect(fillMonths({ from: "2026-09-10", to: "2026-11-12" }, new Map([["2026-10", 5n]]))).toEqual([
      { month: "2026-09", bytes: "0" },
      { month: "2026-10", bytes: "5" },
      { month: "2026-11", bytes: "0" },
    ]);
  });
});

const row = (name: string, values: Partial<UsageRowValues> = {}): UsageRowValues => ({
  id: name.padEnd(12, "0"),
  name,
  isAdmin: false,
  usedBytes: "0",
  quotaBytes: null,
  files: 0,
  folders: 0,
  trashBytes: "0",
  trafficBytes: "0",
  apiTokens: 0,
  lastLoginAt: "2026-11-01T00:00:00.000Z",
  ...values,
});

describe("sortUsage", () => {
  const rows = [row("b", { usedBytes: "9007199254740993", files: 1 }), row("a", { usedBytes: "9007199254740992", trafficBytes: "10", folders: 5 }), row("c")];

  it("sorts sizes beyond 2^53 exactly", () => {
    expect(sortUsage(rows, "used").map((entry) => entry.name)).toEqual(["b", "a", "c"]);
  });

  it("sorts by traffic, items and name", () => {
    expect(sortUsage(rows, "traffic").map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(sortUsage(rows, "items").map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(sortUsage(rows, "name").map((entry) => entry.name)).toEqual(["a", "b", "c"]);
  });
});

describe("CSV", () => {
  it("writes one line per account", () => {
    expect(usageCsvRows([row("anon-abc123", { isAdmin: true, quotaBytes: "100" })])).toEqual([["anon-abc1230", "anon-abc123", "Admin", "0", "100", 0, 0, "0", "0", 0, "2026-11-01T00:00:00.000Z"]]);
  });

  it("names the file after the range", () => {
    expect(usageCsvName({ from: "2026-10-14", to: "2026-11-12" })).toBe("relayfiles-usage-2026-10-14-2026-11-12.csv");
  });
});

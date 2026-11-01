import { describe, expect, it } from "vitest";
import { activityCsv, activityCsvName, activitySummary } from "./link-activity";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("activitySummary", () => {
  it("counts kinds overall and per recent period", () => {
    const events = [
      { kind: "open", at: at(1) },
      { kind: "open", at: at(10) },
      { kind: "view", at: at(6.9) },
      { kind: "play", at: at(29) },
      { kind: "download", at: at(31) },
      { kind: "reset", at: at(1) },
    ];
    expect(activitySummary(events, NOW, [7, 30])).toEqual({
      all: { open: 2, view: 1, play: 1, download: 1 },
      recent: [
        { days: 7, counts: { open: 1, view: 1, play: 0, download: 0 } },
        { days: 30, counts: { open: 2, view: 1, play: 1, download: 0 } },
      ],
    });
  });

  it("includes the period's first moment and ignores future times", () => {
    const summary = activitySummary([{ kind: "open", at: at(7) }, { kind: "open", at: at(-1) }], NOW, [7]);
    expect(summary.recent[0]!.counts.open).toBe(1);
    expect(summary.all.open).toBe(2);
  });

  it("is all zeros without events", () => {
    expect(activitySummary([], NOW, [])).toEqual({ all: { open: 0, view: 0, play: 0, download: 0 }, recent: [] });
  });
});

describe("activityCsv", () => {
  it("writes a header and one escaped, formula-guarded row per event", () => {
    const csv = activityCsv([
      { kind: "download", fileName: 'a,"b".txt', device: "Firefox · Linux", ipMasked: "10.0.•••.•••", country: "KR", at: "2026-10-30T01:02:03.000Z" },
      { kind: "view", fileName: "=cmd|' /C calc'!A0", device: "", ipMasked: "", country: "", at: "2026-10-29T00:00:00.000Z" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Time (UTC),Event,File,Device,Address,Country",
      '2026-10-30T01:02:03.000Z,download,"a,""b"".txt",Firefox · Linux,10.0.•••.•••,KR',
      "2026-10-29T00:00:00.000Z,view,'=cmd|' /C calc'!A0,,,",
      "",
    ]);
  });
});

describe("activityCsvName", () => {
  it("names the export after the item", () => {
    expect(activityCsvName("Holiday")).toBe("Holiday activity.csv");
    expect(activityCsvName("movie.mp4")).toBe("movie.mp4 activity.csv");
  });
});

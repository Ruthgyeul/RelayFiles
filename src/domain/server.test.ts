import { describe, expect, it } from "vitest";
import { counterRate, cronLabel, formatUptime, linkLabel, parseDiskstats, rateSeries, rateStats } from "./server";

const HOUR_MS = 3_600_000;

describe("server page rules", () => {
  it("formats uptime like the design", () => {
    expect(formatUptime(23 * 86_400 + 4 * 3_600 + 59)).toBe("23d 4h");
    expect(formatUptime(4 * 3_600 + 12 * 60)).toBe("4h 12m");
    expect(formatUptime(12 * 60 + 30)).toBe("12m");
  });

  it("labels daily cleanup schedules", () => {
    expect(cronLabel("0 4 * * *")).toBe("Daily 04:00");
    expect(cronLabel("30 23 * * *")).toBe("Daily 23:30");
    expect(cronLabel("0 */6 * * *")).toBe("Schedule 0 */6 * * *");
  });

  it("summarizes rate samples", () => {
    expect(rateStats([10, 30, 20], 60)).toEqual({ avg: 20, peak: 30, total: 3_600 });
    expect(rateStats([], 60)).toEqual({ avg: 0, peak: 0, total: 0 });
  });

  it("groups samples into wall-clock hours, the current hour last", () => {
    const now = 100 * HOUR_MS + 30 * 60_000;
    const series = rateSeries(
      [
        { at: 97 * HOUR_MS, perSec: 999 }, // before the window
        { at: 98 * HOUR_MS + 1, perSec: 10 },
        { at: 98 * HOUR_MS + 2, perSec: 30 },
        { at: 100 * HOUR_MS + 5, perSec: 20 },
        { at: 101 * HOUR_MS, perSec: 999 }, // after the current hour
      ],
      now,
      3,
      60,
    );
    expect(series.hours).toEqual([{ avg: 20, peak: 30 }, null, { avg: 20, peak: 20 }]);
    expect(series).toMatchObject({ avg: 20, peak: 30, total: 3_600 });
  });

  it("reports no hours without samples", () => {
    expect(rateSeries([], HOUR_MS, 2, 60)).toEqual({ hours: [null, null], avg: 0, peak: 0, total: 0 });
  });

  it("turns counters into rates", () => {
    expect(counterRate(1_000, 7_000, 60)).toBe(100);
    expect(counterRate(7_000, 1_000, 60)).toBeNull();
    expect(counterRate(1_000, 1_000, 0)).toBeNull();
  });

  it("reads bytes from /proc/diskstats sectors", () => {
    const text = [
      "   8       0 sda 1200 30 4000 500 800 20 6000 900 0 1000 1400 0 0 0 0",
      "   8       1 sda1 100 0 200 10 50 0 300 20 0 30 30",
      "",
      "garbage",
    ].join("\n");
    expect(parseDiskstats(text)).toEqual(
      new Map([
        ["sda", { readBytes: 4000 * 512, writeBytes: 6000 * 512 }],
        ["sda1", { readBytes: 200 * 512, writeBytes: 300 * 512 }],
      ]),
    );
  });

  it("labels the link speed", () => {
    expect(linkLabel(1_000)).toBe("1 Gbps link");
    expect(linkLabel(2_500)).toBe("2.5 Gbps link");
    expect(linkLabel(100)).toBe("100 Mbps link");
    expect(linkLabel(null)).toBeNull();
    expect(linkLabel(-1)).toBeNull();
  });
});

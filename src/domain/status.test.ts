import { describe, expect, it } from "vitest";
import {
  componentChecks,
  dayKeyIn,
  dayKeysEndingWith,
  formatDayKey,
  componentState,
  connectionLevel,
  connectionStats,
  dayLevel,
  incidentWhen,
  jitterRating,
  latencyRating,
  latencySummary,
  latencyTone,
  levelOfHealth,
  lossTone,
  STATUS_TITLE,
  uptimePercent,
  uptimeText,
  type Ping,
} from "./status";

const ping = (ms: number, ok = true): Ping => ({ ms, ok, at: 0 });

describe("status levels", () => {
  it("maps health to the design wording", () => {
    expect(STATUS_TITLE[levelOfHealth("ok")]).toBe("All systems operational");
    expect(STATUS_TITLE[levelOfHealth("degraded")]).toBe("Degraded performance");
    expect(STATUS_TITLE[levelOfHealth("down")]).toBe("Can't reach the server");
    expect(levelOfHealth(null)).toBe("down");
  });
});

describe("browser checks", () => {
  it("averages successful checks and measures jitter and loss like the design", () => {
    const stats = connectionStats([ping(40), ping(60), ping(0, false), ping(50)]);
    expect(stats).toMatchObject({ avg: 50, jitter: 15, loss: 25, checks: 4, okChecks: 3 });
    expect(stats.last).toEqual(ping(50));
    expect(connectionStats([])).toMatchObject({ avg: null, jitter: null, loss: 0, last: null });
  });

  it("rates the connection", () => {
    expect(connectionLevel(connectionStats([ping(40)]), true)).toBe("ok");
    expect(connectionLevel(connectionStats([ping(40)]), false)).toBe("down");
    expect(connectionLevel(connectionStats([ping(40), ping(0, false)]), true)).toBe("down");
    expect(connectionLevel(connectionStats([ping(450)]), true)).toBe("warn");
    expect(connectionLevel(connectionStats([ping(0, false), ...Array.from({ length: 9 }, () => ping(30))]), true)).toBe("warn");
  });

  it("uses the design's latency, jitter and loss thresholds", () => {
    expect([null, 99, 100, 249, 250, 499, 500].map(latencyRating)).toEqual(["Measuring…", "Excellent", "Good", "Good", "Fair", "Fair", "Poor"]);
    expect([null, 249, 250, 500].map(latencyTone)).toEqual(["neutral", "ok", "warn", "bad"]);
    expect([null, 29, 30, 80].map((value) => jitterRating(value).text)).toEqual(["Measuring…", "Stable", "Some variation", "Unstable"]);
    expect([0, 5, 6].map(lossTone)).toEqual(["ok", "warn", "bad"]);
  });
});

describe("service components", () => {
  const healthy = { reachable: true, database: true, redis: true, storage: true, writable: true };

  it("derives each feature from what it depends on", () => {
    expect(Object.values(componentChecks(healthy)).every(Boolean)).toBe(true);
    expect(componentChecks({ ...healthy, reachable: false })).toEqual({ website: false, uploads: false, streaming: false, downloads: false, shares: false, storage: true });
    expect(componentChecks({ ...healthy, redis: false })).toMatchObject({ website: true, uploads: false, streaming: true, downloads: false, shares: false });
    expect(componentChecks({ ...healthy, writable: false })).toMatchObject({ uploads: false, streaming: true });
    expect(componentChecks({ ...healthy, storage: false })).toMatchObject({ website: true, streaming: false, storage: false });
  });

  it("rates days and uptime", () => {
    expect(dayLevel(0, 0)).toBe("nodata");
    expect(dayLevel(1_440, 0)).toBe("ok");
    expect(dayLevel(1_430, 10)).toBe("warn");
    expect(dayLevel(90, 10)).toBe("down");
    expect(uptimePercent(0, 0)).toBeNull();
    expect(uptimeText(uptimePercent(9_994, 6))).toBe("99.94% uptime");
    expect(uptimeText(null)).toBe("No data yet");
  });

  it("states the current state of a component", () => {
    expect(componentState("website", "down", true)).toBe("unreachable");
    expect(componentState("website", "ok", null)).toBe("nodata");
    expect(componentState("website", "ok", false)).toBe("outage");
    expect(componentState("website", "warn", true)).toBe("slow");
    expect(componentState("storage", "warn", true)).toBe("operational");
  });

  it("summarizes latency hours with data", () => {
    expect(latencySummary([null, { avgMs: 40, failed: false }, { avgMs: null, failed: true }, { avgMs: 80, failed: false }])).toEqual({ avg: 60, best: 40, peak: 80, unreachable: 1 });
    expect(latencySummary([null, null])).toEqual({ avg: null, best: null, peak: null, unreachable: 0 });
  });
});

describe("incidents", () => {
  it("joins the date, duration and state", () => {
    expect(incidentWhen("Oct 2, 2026", "25 min", true)).toBe("Oct 2, 2026 · 25 min · Resolved");
    expect(incidentWhen("Oct 2, 2026", " ", false)).toBe("Oct 2, 2026 · Ongoing");
  });
});

describe("calendar days", () => {
  it("uses the server time zone and counts back from today", () => {
    expect(dayKeyIn(new Date("2026-10-05T16:00:00Z"), "Asia/Seoul")).toBe("2026-10-06");
    expect(dayKeyIn(new Date("2026-10-05T16:00:00Z"), "UTC")).toBe("2026-10-05");
    expect(dayKeysEndingWith("2026-03-01", 3)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(formatDayKey("2026-10-05")).toBe("Oct 5");
    expect(formatDayKey("2026-10-05", true)).toBe("Oct 5, 2026");
  });
});

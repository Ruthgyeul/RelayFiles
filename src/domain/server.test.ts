import { describe, expect, it } from "vitest";
import { bandwidthStats, cronLabel, formatUptime, linkLabel } from "./server";

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

  it("summarizes bandwidth samples", () => {
    expect(bandwidthStats([10, 30, 20], 60)).toEqual({ avg: 20, peak: 30, sent: 3_600 });
    expect(bandwidthStats([], 60)).toEqual({ avg: 0, peak: 0, sent: 0 });
  });

  it("labels the link speed", () => {
    expect(linkLabel(1_000)).toBe("1 Gbps link");
    expect(linkLabel(2_500)).toBe("2.5 Gbps link");
    expect(linkLabel(100)).toBe("100 Mbps link");
    expect(linkLabel(null)).toBeNull();
    expect(linkLabel(-1)).toBeNull();
  });
});

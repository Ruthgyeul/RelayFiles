import { describe, expect, it } from "vitest";
import { formatClock, formatCountdown, formatDateTime, formatLeft, formatShortDate, formatSize } from "./format";

describe("formatClock (prototype fmtT)", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65.9)).toBe("1:05");
    expect(formatClock(3_725)).toBe("1:02:05");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});

describe("formatCountdown", () => {
  it("rounds up and never goes negative", () => {
    expect(formatCountdown(30)).toBe("0:30");
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(0.2)).toBe("0:01");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(600)).toBe("10:00");
  });
});

describe("formatSize (prototype fmtSize)", () => {
  it("uses decimal units with the design's precision", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1000)).toBe("1.0 KB");
    expect(formatSize(2_400_000_000)).toBe("2.4 GB");
    expect(formatSize(18_700_000_000)).toBe("19 GB");
    expect(formatSize(5e15)).toBe("5000 TB");
  });
});

describe("formatLeft (prototype fmtLeft)", () => {
  it("formats remaining time", () => {
    expect(formatLeft(0)).toBe("now");
    expect(formatLeft(30_000)).toBe("1m");
    expect(formatLeft(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(formatLeft(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
  });
});

describe("dates", () => {
  it("formats in en-US like the design", () => {
    const at = new Date(2026, 9, 19, 15, 12);
    expect(formatShortDate(at)).toBe("Oct 19");
    expect(formatDateTime(at)).toBe("Oct 19, 2026, 3:12 PM");
  });
});

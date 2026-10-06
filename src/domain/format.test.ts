import { describe, expect, it } from "vitest";
import { formatClock, formatCountdown } from "./format";

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

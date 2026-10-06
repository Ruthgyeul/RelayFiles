import { describe, expect, it } from "vitest";
import { quotaLevel, quotaMeter, usedPercent } from "./quota";

const GB = 1e9;

describe("quota", () => {
  it("computes the banner level", () => {
    expect(quotaLevel(3 * GB, 5 * GB)).toBe(0);
    expect(quotaLevel(4 * GB, 5 * GB)).toBe(1);
    expect(quotaLevel(4.75 * GB, 5 * GB)).toBe(2);
    expect(quotaLevel(99 * GB, null)).toBe(0);
  });

  it("colors and sizes the meter like the design", () => {
    expect(quotaMeter(0, 5 * GB)).toEqual({ percent: 1, tone: "accent" });
    expect(quotaMeter(3.5 * GB, 5 * GB)).toEqual({ percent: 70, tone: "warn" });
    expect(quotaMeter(4.5 * GB, 5 * GB)).toEqual({ percent: 90, tone: "danger" });
    expect(quotaMeter(9 * GB, 5 * GB)).toEqual({ percent: 100, tone: "danger" });
    expect(quotaMeter(9 * GB, null)).toEqual({ percent: 2, tone: "accent" });
  });

  it("treats unlimited and zero quotas as 0%", () => {
    expect(usedPercent(1, null)).toBe(0);
    expect(usedPercent(1, 0)).toBe(0);
  });
});

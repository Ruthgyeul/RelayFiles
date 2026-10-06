import { describe, expect, it } from "vitest";
import { busyBadge, busyOf, EXPIRY_MS, isExpiryOption, limitHit, nextExpiry, shareStatus, type LinkFacts } from "./share";

describe("expiry", () => {
  const now = 1_000_000;

  it("starts a new choice from now and keeps an unchanged one", () => {
    expect(nextExpiry({ expiry: "Never", expAt: null }, "1 day", now)).toBe(now + EXPIRY_MS["1 day"]);
    expect(nextExpiry({ expiry: "1 day", expAt: 5 }, "1 day", now)).toBe(5);
    expect(nextExpiry({ expiry: "1 day", expAt: 5 }, "7 days", now)).toBe(now + EXPIRY_MS["7 days"]);
    expect(nextExpiry({ expiry: "7 days", expAt: 5 }, "Never", now)).toBeNull();
  });

  it("validates choices", () => {
    expect(isExpiryOption("30 days")).toBe(true);
    expect(isExpiryOption("2 days")).toBe(false);
  });
});

describe("share page status", () => {
  const now = 10_000_000;
  const open: LinkFacts = { expAt: null, burn: false, downloads: 0, downloadLimit: null, effectiveVisibility: "public", hasPassword: false, unlocked: false };

  it("follows the design's order: expired, limit, private, password, open", () => {
    expect(shareStatus(open, now)).toBe("open");
    expect(shareStatus({ ...open, hasPassword: true }, now)).toBe("locked");
    expect(shareStatus({ ...open, hasPassword: true, unlocked: true }, now)).toBe("open");
    expect(shareStatus({ ...open, hasPassword: true, effectiveVisibility: "private" }, now)).toBe("private");
    expect(shareStatus({ ...open, effectiveVisibility: "private", downloadLimit: 2, downloads: 2 }, now)).toBe("blocked");
    expect(shareStatus({ ...open, downloadLimit: 2, downloads: 2, expAt: now }, now)).toBe("expired");
    expect(shareStatus({ ...open, burn: true }, now)).toBe("open");
    expect(shareStatus({ ...open, burn: true, downloads: 1 }, now)).toBe("expired");
  });

  it("treats a missing or zero limit as no limit", () => {
    expect(limitHit(null, 5)).toBe(false);
    expect(limitHit(0, 5)).toBe(false);
    expect(limitHit(3, 2)).toBe(false);
    expect(limitHit(3, 3)).toBe(true);
  });
});

describe("busy level", () => {
  const limits = { windowMs: 600_000, throttleAt: 5, pauseAt: 10 };
  const now = 100_000_000;
  const times = (count: number) => Array.from({ length: count }, (_, index) => now - index * 1_000);

  it("throttles at 5 and pauses at 10 downloads in 10 minutes", () => {
    expect(busyOf(times(4), false, now, limits).level).toBe(0);
    expect(busyOf(times(5), false, now, limits)).toEqual({ level: 1, count: 5, until: null, manual: false });
    // The pause lasts until the 10th most recent download leaves the window.
    expect(busyOf(times(12), false, now, limits)).toEqual({ level: 2, count: 12, until: now - 9_000 + 600_000, manual: false });
    expect(busyOf([...times(3), now - 700_000], false, now, limits).count).toBe(3);
    expect(busyOf([], true, now, limits)).toEqual({ level: 2, count: 0, until: null, manual: true });
  });

  it("words badges for the app and the share page", () => {
    const paused = busyOf(times(10), false, now, limits);
    expect(busyBadge(paused, now, "share")?.label).toBe("Server busy · retry in 9m");
    expect(busyBadge(paused, now, "app")).toEqual({ level: 2, label: "Server busy", tip: "10 downloads in the last 10 min · downloads paused for 9m" });
    expect(busyBadge(busyOf(times(6), false, now, limits), now, "share")).toEqual({ level: 1, label: "Busy · slower downloads", tip: "6 downloads in the last 10 min · downloads are throttled" });
    expect(busyBadge(busyOf([], true, now, limits), now, "share")?.label).toBe("Downloads paused");
    expect(busyBadge(busyOf([], false, now, limits), now, "app")).toBeNull();
  });
});

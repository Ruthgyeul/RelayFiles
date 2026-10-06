import { describe, expect, it } from "vitest";
import { accountStatus, applyManage, managePreview, matchesFilter, quotaNote, scheduledDeletion, type AdminLifecycle } from "./admin";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 6);
const member = (createdDaysAgo: number, extra: Partial<AdminLifecycle> = {}): AdminLifecycle => ({ createdAt: now - createdDaysAgo * DAY, expiresAt: null, isAdmin: false, neverExpire: false, ...extra });
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

describe("account status", () => {
  it("badges admins, exempt, expiring and expired accounts", () => {
    expect(accountStatus(member(0, { isAdmin: true }), 14, now)).toEqual({ status: "admin", left: Infinity });
    expect(accountStatus(member(30, { neverExpire: true }), 14, now)).toEqual({ status: "active", left: Infinity });
    expect(accountStatus(member(2), 14, now)).toEqual({ status: "active", left: 12 });
    expect(accountStatus(member(7), 14, now)).toEqual({ status: "soon", left: 7 });
    expect(accountStatus(member(14), 14, now)).toEqual({ status: "expired", left: 0 });
    expect(accountStatus(member(30, { expiresAt: now + 40 * DAY }), 14, now).left).toBe(40);
  });

  it("filters like the design (Active includes admins)", () => {
    expect(matchesFilter("admin", "active")).toBe(true);
    expect(matchesFilter("soon", "active")).toBe(false);
    expect(matchesFilter("expired", "all")).toBe(true);
  });
});

describe("manage", () => {
  const draft = { isAdmin: false, days: 0 as const, reset: false };

  it("adds extensions to the current deletion date, or to today when it has passed", () => {
    const fresh = member(4); // deletes in 10 days
    expect(applyManage(fresh, { ...draft, days: 7 }, 14, now)).toEqual({ expiresAt: now + 17 * DAY, neverExpire: false });
    const late = member(20); // deleted 6 days ago
    expect(applyManage(late, { ...draft, days: 30 }, 14, now).expiresAt).toBe(now + 30 * DAY);
  });

  it("restarts, resets to default and exempts", () => {
    const extended = member(4, { expiresAt: now + 100 * DAY });
    expect(applyManage(extended, { ...draft, reset: true }, 14, now).expiresAt).toBe(now + 14 * DAY);
    expect(applyManage(extended, { ...draft, reset: true, days: 7 }, 14, now).expiresAt).toBe(now + 21 * DAY);
    expect(applyManage(extended, { ...draft, days: "default" }, 14, now).expiresAt).toBeNull();
    expect(applyManage(extended, { ...draft, days: "never" }, 14, now)).toEqual({ expiresAt: now + 100 * DAY, neverExpire: true });
    expect(applyManage(extended, draft, 14, now).expiresAt).toBe(now + 100 * DAY);
  });

  it("previews the new date", () => {
    const fresh = member(4);
    expect(managePreview(fresh, draft, 14, now, day)).toBe(`Currently deletes ${day(now + 10 * DAY)}. No change.`);
    expect(managePreview(fresh, { ...draft, days: 30 }, 14, now, day)).toBe(`Currently deletes ${day(now + 10 * DAY)}. After saving: ${day(now + 40 * DAY)}.`);
    expect(managePreview(fresh, { ...draft, isAdmin: true }, 14, now, day)).toBe("This account will never be deleted automatically.");
    expect(scheduledDeletion(fresh, 14)).toBe(now + 10 * DAY);
  });

  it("warns when the new limit is below what is used", () => {
    const size = (bytes: number) => `${bytes / 1e9} GB`;
    expect(quotaNote(2e9, 5, size)).toBe("Using 2 GB.");
    expect(quotaNote(6e9, 5, size)).toBe("Using 6 GB. Over the new limit: existing files stay, new uploads are blocked.");
    expect(quotaNote(6e9, null, size)).toBe("Using 6 GB.");
  });
});

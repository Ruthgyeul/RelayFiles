import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, accountColor, dailySeries, daysLeft, deletionDate, deviceLocation, isExpired, maskToken, retentionText } from "./account";

const DAY = 86_400_000;
const created = new Date("2026-10-01T00:00:00Z");
const member = { createdAt: created, expiresAt: null, isAdmin: false, neverExpire: false };

describe("account lifecycle", () => {
  it("deletes members ttl days after creation", () => {
    expect(deletionDate(member, 14)).toEqual(new Date(created.getTime() + 14 * DAY));
    expect(daysLeft(member, 14, new Date(created.getTime() + 13.5 * DAY))).toBe(1);
    expect(isExpired(member, 14, new Date(created.getTime() + 14 * DAY))).toBe(true);
  });

  it("uses an admin extension and never expires admins or exempt accounts", () => {
    const extended = { ...member, expiresAt: new Date("2027-01-01T00:00:00Z") };
    expect(deletionDate(extended, 14)).toEqual(extended.expiresAt);
    expect(deletionDate({ ...member, isAdmin: true }, 14)).toBeNull();
    expect(daysLeft({ ...member, neverExpire: true }, 14, created)).toBeNull();
    expect(isExpired({ ...member, isAdmin: true }, 14, new Date("2099-01-01"))).toBe(false);
  });

  it("never reports negative days", () => {
    expect(daysLeft(member, 14, new Date("2030-01-01"))).toBe(0);
  });

  it("picks a stable color from the design palette", () => {
    expect(ACCOUNT_COLORS).toContain(accountColor("abcdefghjkmn"));
    expect(accountColor("abcdefghjkmn")).toBe(accountColor("abcdzzzzzzzz"));
  });
});

describe("profile helpers", () => {
  it("masks the token like the design", () => {
    expect(maskToken("ABCD" + "x".repeat(32) + "WXYZ")).toBe(`ABCD${"•".repeat(28)}WXYZ`);
  });

  it("explains retention per account type", () => {
    expect(retentionText({ isAdmin: true, neverExpire: true, extended: false }, "")).toMatch(/^Admin account\./);
    expect(retentionText({ isAdmin: false, neverExpire: true, extended: false }, "")).toMatch(/^An admin has exempted/);
    expect(retentionText({ isAdmin: false, neverExpire: false, extended: false }, "Oct 20, 2026")).toContain("on Oct 20, 2026, 14 days after it was created, whether");
    expect(retentionText({ isAdmin: false, neverExpire: false, extended: true }, "Nov 1, 2026")).toContain("on Nov 1, 2026 (extended by the admin), whether");
  });

  it("fills days without traffic with zero, oldest first", () => {
    const today = new Date("2026-10-06T15:00:00Z");
    const rows = [
      { day: new Date("2026-10-06T00:00:00Z"), bytes: 5n },
      { day: new Date("2026-10-04T00:00:00Z"), bytes: 2n },
      { day: new Date("2026-08-01T00:00:00Z"), bytes: 9n },
    ];
    expect(dailySeries(rows, 3, today)).toEqual([2n, 0n, 5n]);
    expect(dailySeries([], 30, today)).toHaveLength(30);
  });

  it("names where a device signed in from", () => {
    expect(deviceLocation("KR", "Seoul")).toBe("Seoul, KR");
    expect(deviceLocation("KR", null)).toBe("KR");
    expect(deviceLocation(null, null)).toBe("Local network");
  });
});

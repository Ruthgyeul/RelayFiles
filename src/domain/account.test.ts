import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, accountColor, daysLeft, deletionDate, isExpired } from "./account";

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

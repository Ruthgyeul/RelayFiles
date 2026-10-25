import { describe, expect, it } from "vitest";
import { AUTH, MS } from "@/config/policy";
import { hasRecentAuth, isSessionOver, sessionEndsAt } from "./session";

describe("session lifetime", () => {
  const signedIn = 1_000_000;

  it("ends admin sessions sooner than member sessions", () => {
    expect(sessionEndsAt(signedIn, true)).toBe(signedIn + AUTH.adminSessionDays * MS.day);
    expect(sessionEndsAt(signedIn, false)).toBe(signedIn + AUTH.memberSessionDays * MS.day);
    const session = { createdAt: signedIn, reauthAt: null };
    expect(isSessionOver(session, true, sessionEndsAt(signedIn, true) - 1)).toBe(false);
    expect(isSessionOver(session, true, sessionEndsAt(signedIn, true))).toBe(true);
    expect(isSessionOver(session, false, sessionEndsAt(signedIn, true))).toBe(false);
  });

  it("counts sign-in and re-authentication as a recent token entry", () => {
    const window = AUTH.reauthWindowMin * MS.minute;
    expect(hasRecentAuth({ createdAt: signedIn, reauthAt: null }, signedIn + window - 1)).toBe(true);
    expect(hasRecentAuth({ createdAt: signedIn, reauthAt: null }, signedIn + window)).toBe(false);
    expect(hasRecentAuth({ createdAt: signedIn, reauthAt: signedIn + window }, signedIn + window + 1)).toBe(true);
  });
});

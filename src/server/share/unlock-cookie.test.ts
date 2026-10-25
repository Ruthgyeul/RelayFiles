import { describe, expect, it } from "vitest";
import { MS, SHARE } from "@/config/policy";
import { encodeSigned } from "../auth/signed-cookie";
import { addUnlock, decodeUnlocks, isUnlocked, type Unlocks } from "./unlock-cookie";

const secret = "unit-test-cookie-secret-0123456789abcdef";
const previous = "previous-cookie-secret-0123456789abcdef";
const now = 1_700_000_000_000;
const none: Unlocks = new Map();

describe("unlock cookie", () => {
  it("round-trips unlocks for the password they were made with", () => {
    const raw = addUnlock(none, "abcDEF1234", "$argon2id$hash-one", secret, now);
    const unlocks = decodeUnlocks(raw, [secret], now);
    expect(unlocks.get("abcDEF1234")?.until).toBe(now / MS.second + SHARE.unlockHours * 3_600);
    expect(isUnlocked(unlocks, "abcDEF1234", "$argon2id$hash-one", [secret])).toBe(true);
    expect(isUnlocked(unlocks, "abcDEF1234", "$argon2id$hash-two", [secret])).toBe(false);
    expect(isUnlocked(unlocks, "otherLink1", "$argon2id$hash-one", [secret])).toBe(false);
  });

  it("keeps working through a cookie secret rotation", () => {
    const unlocks = decodeUnlocks(addUnlock(none, "abcDEF1234", "h", previous, now), [secret, previous], now);
    expect(isUnlocked(unlocks, "abcDEF1234", "h", [secret, previous])).toBe(true);
  });

  it("drops expired, tampered, foreign and version 1 values", () => {
    const raw = addUnlock(none, "abcDEF1234", "h", secret, now);
    expect(decodeUnlocks(raw, [secret], now + (SHARE.unlockHours + 1) * MS.hour).size).toBe(0);
    expect(decodeUnlocks(`${raw}x`, [secret], now).size).toBe(0);
    expect(decodeUnlocks(raw, [previous], now).size).toBe(0);
    const v1 = encodeSigned({ v: 1, u: [["abcDEF1234", now / MS.second + 60]] }, secret, "share:");
    expect(decodeUnlocks(v1, [secret], now).size).toBe(0);
    // A session cookie value (signed for another purpose) is not an unlock cookie.
    expect(decodeUnlocks(encodeSigned({ v: 2, u: [["abcDEF1234", now / MS.second + 60, "tag"]] }, secret, ""), [secret], now).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { EXPIRY_MS, isExpiryOption, nextExpiry } from "./share";

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

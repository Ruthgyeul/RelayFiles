import { describe, expect, it } from "vitest";
import { bytesToGb, capReached, gbToBytes, secondsUntilUtcMidnight, utcDay } from "./traffic";

describe("secondsUntilUtcMidnight", () => {
  it("counts to the next UTC midnight", () => {
    expect(secondsUntilUtcMidnight(Date.parse("2026-11-12T23:59:00Z"))).toBe(60);
    expect(secondsUntilUtcMidnight(Date.parse("2026-11-12T00:00:00Z"))).toBe(86_400);
  });

  it("is never 0", () => {
    expect(secondsUntilUtcMidnight(Date.parse("2026-11-12T23:59:59.900Z"))).toBe(1);
  });
});

describe("utcDay", () => {
  it("is the UTC calendar day", () => {
    expect(utcDay(Date.parse("2026-11-12T23:30:00-05:00"))).toBe("2026-11-13");
  });
});

describe("capReached", () => {
  const none = { used: 10n, cap: null };
  it("refuses once a limit is used up, the link's first", () => {
    expect(capReached({ used: 100n, cap: 100n }, { used: 500n, cap: 100n })).toBe("link");
    expect(capReached({ used: 99n, cap: 100n }, { used: 500n, cap: 500n })).toBe("account");
    expect(capReached({ used: 99n, cap: 100n }, { used: 499n, cap: 500n })).toBeNull();
  });

  it("allows everything without limits", () => {
    expect(capReached(none, none)).toBeNull();
  });
});

describe("GB", () => {
  it("converts decimal GB both ways", () => {
    expect(gbToBytes(5)).toBe(5_000_000_000n);
    expect(gbToBytes(0.5)).toBe(500_000_000n);
    expect(bytesToGb(5_000_000_000n)).toBe(5);
    expect(bytesToGb(null)).toBeNull();
  });
});

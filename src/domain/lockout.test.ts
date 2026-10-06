import { describe, expect, it } from "vitest";
import { attemptsLeft, failureMessage, lockSecondsAfter } from "./lockout";

describe("lockout ladder (design: 5 attempts, 30/120/600 s)", () => {
  const policy = { maxAttempts: 5, lockSeconds: [30, 120, 600] };

  it("locks on every fifth failure with increasing lengths", () => {
    expect([1, 2, 3, 4].map((f) => lockSecondsAfter(f, policy))).toEqual([0, 0, 0, 0]);
    expect(lockSecondsAfter(5, policy)).toBe(30);
    expect(lockSecondsAfter(10, policy)).toBe(120);
    expect(lockSecondsAfter(15, policy)).toBe(600);
    expect(lockSecondsAfter(25, policy)).toBe(600);
  });

  it("counts attempts left", () => {
    expect(attemptsLeft(1, policy)).toBe(4);
    expect(attemptsLeft(4, policy)).toBe(1);
    expect(attemptsLeft(6, policy)).toBe(4);
  });

  it("uses the design messages", () => {
    expect(failureMessage("short", 1, policy, 40)).toBe("Tokens are 40 characters. 4 attempts left before a lockout.");
    expect(failureMessage("x".repeat(40), 3, policy, 40)).toBe("No account matches this token. 2 attempts left before a lockout.");
  });
});

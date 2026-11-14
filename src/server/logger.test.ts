import { describe, expect, it } from "vitest";
import { redact } from "./logger";

describe("redact", () => {
  it("hides tokens, passwords, secrets, cookies and IPs at any depth", () => {
    const input = {
      accountId: "abcdefghjkmn",
      token: "AbCd1234",
      nested: { password: "hunter2", headers: { authorization: "Bearer x", cookie: "rf_s=1", "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4", "true-client-ip": "1.2.3.4" } },
      list: [{ ip: "1.2.3.4", name: "ok" }],
      tokenEnc: "...",
      COOKIE_SECRET: "...",
    };
    expect(redact(input)).toEqual({
      accountId: "abcdefghjkmn",
      token: "[redacted]",
      nested: { password: "[redacted]", headers: { authorization: "[redacted]", cookie: "[redacted]", "x-forwarded-for": "[redacted]", "x-real-ip": "[redacted]", "true-client-ip": "[redacted]" } },
      list: [{ ip: "[redacted]", name: "ok" }],
      tokenEnc: "[redacted]",
      COOKIE_SECRET: "[redacted]",
    });
  });

  it("drops what is nested too deep to check instead of logging it", () => {
    let deep: Record<string, unknown> = { token: "AbCd1234" };
    for (let level = 0; level < 10; level++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).not.toContain("AbCd1234");
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });

  it("keeps errors readable and leaves primitives alone", () => {
    const error = new Error("boom");
    expect(redact(error)).toMatchObject({ name: "Error", message: "boom" });
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBeNull();
  });
});

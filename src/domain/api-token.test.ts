import { describe, expect, it } from "vitest";
import { API, MS } from "@/config/policy";
import { apiTokenIdOf, bearerToken, hasScope, tokenExpired, tokenHealth, tokenHealthText } from "./api-token";
import { newAccountToken, newApiToken, newApiTokenId } from "./ids";

describe("personal API tokens", () => {
  it("reads only well-formed personal tokens from the Authorization header", () => {
    const id = newApiTokenId();
    const token = newApiToken(id);
    expect(token).toMatch(new RegExp(`^rfp_${id}_[A-Za-z0-9]{43}$`));
    expect(apiTokenIdOf(token)).toBe(id);
    expect(apiTokenIdOf(`rfp_${id}_short`)).toBeNull();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer  ${token} `)).toBe(token);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(`Basic ${token}`)).toBeNull();
    expect(bearerToken(`Bearer ${newAccountToken()}`)).toBeNull();
    expect(bearerToken(`Bearer ${token}x`)).toBeNull();
    expect(bearerToken(`Bearer ${token} extra`)).toBeNull();
  });

  it("checks scopes and expiry", () => {
    expect(hasScope(["files:read"], "files:read")).toBe(true);
    expect(hasScope(["files:read"], "files:write")).toBe(false);
    expect(tokenExpired(null, 5)).toBe(false);
    expect(tokenExpired(10, 5)).toBe(false);
    expect(tokenExpired(5, 5)).toBe(true);
  });
});

describe("tokenHealth", () => {
  const now = 1_000 * MS.day;
  const days = (n: number) => n * MS.day;

  it("flags tokens that expire within the warning window, or already expired", () => {
    const base = { createdAt: now - days(1), lastUsedAt: now };
    expect(tokenHealth({ ...base, expiresAt: now + days(API.expiringWarnDays) }, now)).toBe("expiring");
    expect(tokenHealth({ ...base, expiresAt: now - 1 }, now)).toBe("expiring");
    expect(tokenHealth({ ...base, expiresAt: now + days(API.expiringWarnDays) + 1 }, now)).toBe("ok");
    expect(tokenHealth({ ...base, expiresAt: null }, now)).toBe("ok");
  });

  it("flags tokens not used for staleAfterDays", () => {
    const base = { createdAt: now - days(400), expiresAt: null };
    expect(tokenHealth({ ...base, lastUsedAt: now - days(API.staleAfterDays) }, now)).toBe("stale");
    expect(tokenHealth({ ...base, lastUsedAt: now - days(API.staleAfterDays) + 1 }, now)).toBe("ok");
  });

  it("flags tokens never used unusedAfterDays after creation", () => {
    expect(tokenHealth({ createdAt: now - days(API.unusedAfterDays), lastUsedAt: null, expiresAt: null }, now)).toBe("unused");
    expect(tokenHealth({ createdAt: now - days(API.unusedAfterDays) + 1, lastUsedAt: null, expiresAt: null }, now)).toBe("ok");
  });

  it("puts expiry before the other warnings", () => {
    expect(tokenHealth({ createdAt: now - days(400), lastUsedAt: null, expiresAt: now + 1 }, now)).toBe("expiring");
  });

  it("describes each warning", () => {
    expect(tokenHealthText("ok")).toBeNull();
    expect(tokenHealthText("expiring")).toBe("Expires soon");
    expect(tokenHealthText("stale")).toBe(`Not used for ${API.staleAfterDays} days`);
    expect(tokenHealthText("unused")).toBe("Never used");
  });
});

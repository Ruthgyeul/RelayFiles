import { describe, expect, it } from "vitest";
import { apiTokenIdOf, bearerToken, hasScope, tokenExpired } from "./api-token";
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

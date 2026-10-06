import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeSessionCookie, encodeSessionCookie } from "./session-cookie";
import { decryptToken, encryptToken, needsReencryption, tokenLookups } from "./token-crypto";

const keys = { encKey: randomBytes(32), hmacKey: "h".repeat(32) };
const TOKEN = "AbCdEfGhJkLmNpQrStUvWxYz23456789abcdefgh";

describe("token crypto", () => {
  it("round-trips tokens and never stores them in plain text", () => {
    const enc = encryptToken(TOKEN, keys);
    expect(enc.toString("utf8")).not.toContain(TOKEN);
    expect(decryptToken(enc, keys)).toBe(TOKEN);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptToken(TOKEN, keys).equals(encryptToken(TOKEN, keys))).toBe(false);
  });

  it("detects tampering", () => {
    const enc = encryptToken(TOKEN, keys);
    enc[enc.length - 1]! ^= 1;
    expect(() => decryptToken(enc, keys)).toThrow();
  });

  it("keeps values readable during key rotation", () => {
    const old = encryptToken(TOKEN, keys);
    const rotated = { encKey: randomBytes(32), hmacKey: "n".repeat(32), previousEncKey: keys.encKey, previousHmacKey: keys.hmacKey };
    expect(decryptToken(old, rotated)).toBe(TOKEN);
    expect(needsReencryption(old, rotated)).toBe(true);
    expect(needsReencryption(encryptToken(TOKEN, rotated), rotated)).toBe(false);
    expect(tokenLookups(TOKEN, rotated)).toEqual([tokenLookups(TOKEN, { ...rotated, previousHmacKey: undefined })[0], tokenLookups(TOKEN, keys)[0]]);
    expect(() => decryptToken(old, { encKey: randomBytes(32), hmacKey: "x".repeat(32) })).toThrow(/unknown key/);
  });

  it("produces deterministic lookups", () => {
    expect(tokenLookups(TOKEN, keys)).toEqual(tokenLookups(TOKEN, keys));
    expect(tokenLookups(TOKEN, keys)[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("session cookie", () => {
  const secret = "c".repeat(32);
  const ids = ["s".repeat(32), "t".repeat(32)];

  it("round-trips session ids and the active session", () => {
    const raw = encodeSessionCookie({ sessionIds: ids, activeSessionId: ids[0]! }, secret);
    expect(decodeSessionCookie(raw, [secret])).toEqual({ sessionIds: ids, activeSessionId: ids[0] });
  });

  it("defaults the active session to the newest one", () => {
    const raw = encodeSessionCookie({ sessionIds: ids, activeSessionId: "not-in-list" }, secret);
    expect(decodeSessionCookie(raw, [secret]).activeSessionId).toBe(ids[1]);
  });

  it("rejects tampered, foreign or malformed cookies", () => {
    const raw = encodeSessionCookie({ sessionIds: ids, activeSessionId: null }, secret);
    const [payload, sig] = raw.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, s: ["x".repeat(32)], a: null })).toString("base64url");
    const empty = { sessionIds: [], activeSessionId: null };
    expect(decodeSessionCookie(`${forged}.${sig}`, [secret])).toEqual(empty);
    expect(decodeSessionCookie(raw, ["d".repeat(32)])).toEqual(empty);
    expect(decodeSessionCookie(`${payload}`, [secret])).toEqual(empty);
    expect(decodeSessionCookie(undefined, [secret])).toEqual(empty);
  });

  it("accepts cookies signed with the previous secret during rotation", () => {
    const raw = encodeSessionCookie({ sessionIds: ids, activeSessionId: null }, secret);
    expect(decodeSessionCookie(raw, ["n".repeat(32), secret]).sessionIds).toEqual(ids);
  });

  it("keeps at most 10 sessions, dropping the oldest", () => {
    const many = Array.from({ length: 12 }, (_, i) => `${i}`.padStart(32, "s"));
    const decoded = decodeSessionCookie(encodeSessionCookie({ sessionIds: many, activeSessionId: null }, secret), [secret]);
    expect(decoded.sessionIds).toEqual(many.slice(2));
  });
});

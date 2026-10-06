import { describe, expect, it } from "vitest";
import {
  ID_ALPHABET,
  ID_PATTERN,
  isAccountId,
  isLinkId,
  isSessionId,
  newAccountId,
  newAccountToken,
  newAnonName,
  newInviteCode,
  newLinkId,
  newNodeId,
  newSessionId,
  randomString,
} from "./ids";

describe("id generators", () => {
  it("produce the design formats", () => {
    for (let i = 0; i < 50; i++) {
      expect(newAccountId()).toMatch(ID_PATTERN.account);
      expect(newNodeId()).toMatch(ID_PATTERN.node);
      expect(newLinkId()).toMatch(ID_PATTERN.link);
      expect(newAccountToken()).toMatch(ID_PATTERN.token);
      expect(newAnonName()).toMatch(ID_PATTERN.anonName);
      expect(newInviteCode()).toMatch(ID_PATTERN.invite);
      expect(isSessionId(newSessionId())).toBe(true);
    }
  });

  it("never uses look-alike characters", () => {
    const sample = Array.from({ length: 200 }, newAccountId).join("");
    expect(sample).not.toMatch(/[ilo01]/);
  });

  it("is uniform: rejects bytes that would bias the modulo", () => {
    // 256 % 31 = 8, so bytes 248..255 must be skipped.
    const bytes = [255, 248, 0, 30, 31];
    let call = 0;
    const fake = (buffer: Uint8Array) => {
      buffer.fill(0).set(call++ === 0 ? bytes : [], 0);
      return buffer;
    };
    expect(randomString(3, ID_ALPHABET, fake)).toBe(`${ID_ALPHABET[0]}${ID_ALPHABET[30]}${ID_ALPHABET[0]}`);
  });

  it("validates ids", () => {
    expect(isAccountId("abcdefghjkmn")).toBe(true);
    expect(isAccountId("abcdefghjkm1")).toBe(false);
    expect(isAccountId("../etc/passwd")).toBe(false);
    expect(isLinkId("abcdefghjk")).toBe(true);
  });
});

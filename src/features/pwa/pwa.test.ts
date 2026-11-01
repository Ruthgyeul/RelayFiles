import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHARE_TARGET } from "@/config/policy";

const worker = readFileSync("public/sw.js", "utf8");

/** A top-level `const NAME = value;` of the service worker, as written. */
function constant(name: string): string | undefined {
  return new RegExp(`^const ${name} = (.+);$`, "m").exec(worker)?.[1];
}

describe("public/sw.js", () => {
  it("repeats the share target settings of policy.ts", () => {
    expect(constant("SHARE_ACTION")).toBe(JSON.stringify(SHARE_TARGET.action));
    expect(constant("SHARE_PAGE")).toBe(JSON.stringify(SHARE_TARGET.page));
    expect(constant("FILES_FIELD")).toBe(JSON.stringify(SHARE_TARGET.filesField));
    expect(Number(constant("HOLD_MS"))).toBe(SHARE_TARGET.holdMs);
  });

  it("caches nothing and fetches nothing itself", () => {
    expect(worker).not.toMatch(/caches\.|indexedDB|importScripts|fetch\(/);
  });
});

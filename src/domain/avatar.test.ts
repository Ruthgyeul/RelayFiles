import { describe, expect, it } from "vitest";
import { avatarOf } from "./avatar";

/** Verbatim copy of the design prototype's `avatarOf` (docs/design/Relay_App.dc.html), used as the oracle. */
function designAvatarOf(seedIn: unknown): string {
  const seed = String(seedIn || "x");
  let x = 2166136261;
  for (const c of seed) {
    x ^= c.charCodeAt(0);
    x = Math.imul(x, 16777619) >>> 0;
  }
  const rnd = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const hue = Math.floor(rnd() * 360),
    hue2 = (hue + 30 + Math.floor(rnd() * 60)) % 360;
  const fg = "hsl(" + hue + ",70%,62%)",
    fg2 = "hsl(" + hue2 + ",65%,48%)",
    bg = "hsl(" + hue + ",30%,16%)";
  let r = "";
  for (let y = 0; y < 6; y++)
    for (let c = 0; c < 3; c++) {
      const v = rnd();
      if (v < 0.52) {
        const col = v < 0.16 ? fg2 : fg;
        r +=
          '<rect x="' + c + '" y="' + y + '" width="1" height="1" fill="' + col + '"/><rect x="' + (5 - c) + '" y="' + y + '" width="1" height="1" fill="' + col + '"/>';
      }
    }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 8 8" shape-rendering="crispEdges"><rect x="-1" y="-1" width="8" height="8" fill="' + bg + '"/>' + r + "</svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

describe("avatarOf", () => {
  const seeds = ["abcdefghjkmn", "p9q8r7s6t5u4", "anon-23456789", "x", "한글계정", "a".repeat(64)];

  it("matches the design prototype output exactly", () => {
    for (const seed of seeds) expect(avatarOf(seed)).toBe(designAvatarOf(seed));
  });

  it("treats empty seeds like the prototype does", () => {
    expect(avatarOf("")).toBe(designAvatarOf(""));
    expect(avatarOf(null)).toBe(avatarOf("x"));
    expect(avatarOf(undefined)).toBe(avatarOf("x"));
  });

  it("is deterministic and differs between seeds", () => {
    expect(avatarOf("abcdefghjkmn")).toBe(avatarOf("abcdefghjkmn"));
    expect(avatarOf("abcdefghjkmn")).not.toBe(avatarOf("abcdefghjkmp"));
  });

  it("returns an SVG data URI", () => {
    expect(avatarOf("seed").startsWith("data:image/svg+xml,%3Csvg")).toBe(true);
  });
});

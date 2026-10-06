/**
 * Deterministic pixel identicon for an account, ported from the design prototype (`avatarOf`).
 * The same seed (account id) always yields the same 6×6 mirrored SVG, returned as a data URI.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_RANGE = 4294967296;
const GRID = 6;
const HALF = GRID / 2;
/** Probability that a cell is painted, and that a painted cell uses the secondary color. */
const PAINT_THRESHOLD = 0.52;
const SECONDARY_THRESHOLD = 0.16;

const cache = new Map<string, string>();

/** FNV-1a hash over UTF-16 code units, matching the prototype's string iteration. */
function hashSeed(seed: string): number {
  let x = FNV_OFFSET;
  for (const char of seed) {
    x ^= char.charCodeAt(0);
    x = Math.imul(x, FNV_PRIME) >>> 0;
  }
  return x;
}

/** xorshift32 generator returning floats in [0, 1). */
function xorshift(state: number): () => number {
  let x = state;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / UINT32_RANGE;
  };
}

function cell(x: number, y: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
}

/** Returns an `data:image/svg+xml` URI for the given seed (empty seeds behave like "x"). */
export function avatarOf(seed: string | null | undefined): string {
  const key = String(seed || "x");
  const hit = cache.get(key);
  if (hit) return hit;

  const rnd = xorshift(hashSeed(key));
  const hue = Math.floor(rnd() * 360);
  const hue2 = (hue + 30 + Math.floor(rnd() * 60)) % 360;
  const fg = `hsl(${hue},70%,62%)`;
  const fg2 = `hsl(${hue2},65%,48%)`;
  const bg = `hsl(${hue},30%,16%)`;

  let rects = "";
  for (let y = 0; y < GRID; y++) {
    for (let c = 0; c < HALF; c++) {
      const v = rnd();
      if (v < PAINT_THRESHOLD) {
        const color = v < SECONDARY_THRESHOLD ? fg2 : fg;
        rects += cell(c, y, color) + cell(GRID - 1 - c, y, color);
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 8 8" shape-rendering="crispEdges">` +
    `<rect x="-1" y="-1" width="8" height="8" fill="${bg}"/>${rects}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

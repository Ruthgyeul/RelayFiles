/**
 * Keyboard moves in the File Manager's list and grid: ↑ ↓ step through rows, ← → through cards,
 * Home and End jump to the ends. ↑ ↓ in the grid go by column (worked out from the layout).
 */

export type ListNavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

const NAV_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"] satisfies readonly ListNavKey[];

export const isListNavKey = (key: string): key is ListNavKey => NAV_KEYS.includes(key);

/**
 * The item a key moves to from `index` among `count` items, staying inside the list; null when
 * the key does not move in this view (← → in a list, ↑ ↓ in a grid, which follow columns).
 */
export function listNavIndex(index: number, key: ListNavKey, count: number, view: "list" | "grid"): number | null {
  if (count === 0) return null;
  const last = count - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  const back = view === "list" ? key === "ArrowUp" : key === "ArrowLeft";
  const forward = view === "list" ? key === "ArrowDown" : key === "ArrowRight";
  if (back) return Math.max(0, index - 1);
  if (forward) return Math.min(last, index + 1);
  return null;
}

/** A card's place on screen (its left edge and top). */
export interface CardBox {
  left: number;
  top: number;
}

/** Pixels two edges may differ by and still be the same row or column (sub-pixel layout). */
const SAME_EDGE_PX = 2;

/**
 * The card ↑ or ↓ moves to in a grid: in the row above or below, the card whose left edge is
 * closest to this one's (a shorter last row takes its nearest card). Null at the top or bottom row.
 * `boxAt` is asked only for the cards between here and the end of that next row (two rows at
 * most), so a long grid is not measured as a whole on every key press.
 */
export function gridNavIndex(count: number, index: number, key: "ArrowUp" | "ArrowDown", boxAt: (at: number) => CardBox): number | null {
  if (index < 0 || index >= count) return null;
  const from = boxAt(index);
  const step = key === "ArrowDown" ? 1 : -1;
  const past = (top: number, edge: number) => (step > 0 ? top > edge + SAME_EDGE_PX : top < edge - SAME_EDGE_PX);
  let rowTop: number | null = null;
  let best: number | null = null;
  let bestGap = Infinity;
  for (let at = index + step; at >= 0 && at < count; at += step) {
    const box = boxAt(at);
    if (rowTop === null) {
      // Still in this card's own row: keep going until the next row starts.
      if (!past(box.top, from.top)) continue;
      rowTop = box.top;
    } else if (past(box.top, rowTop)) break;
    const gap = Math.abs(box.left - from.left);
    if (gap < bestGap) {
      best = at;
      bestGap = gap;
    }
  }
  return best;
}

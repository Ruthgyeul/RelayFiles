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
 * The card ↑ or ↓ moves to in a grid: the nearest card in the row above or below whose left edge
 * is closest to this one's (a shorter last row takes its last card). Null at the top or bottom row.
 */
export function gridNavIndex(boxes: readonly CardBox[], index: number, key: "ArrowUp" | "ArrowDown"): number | null {
  const from = boxes[index];
  if (!from) return null;
  const down = key === "ArrowDown";
  const rowTops = boxes.map((box) => box.top).filter((top) => (down ? top > from.top + SAME_EDGE_PX : top < from.top - SAME_EDGE_PX));
  if (rowTops.length === 0) return null;
  const rowTop = down ? Math.min(...rowTops) : Math.max(...rowTops);
  let best: number | null = null;
  boxes.forEach((box, at) => {
    if (Math.abs(box.top - rowTop) > SAME_EDGE_PX) return;
    if (best === null || Math.abs(box.left - from.left) < Math.abs(boxes[best]!.left - from.left)) best = at;
  });
  return best;
}

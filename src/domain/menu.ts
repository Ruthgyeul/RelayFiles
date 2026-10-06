/**
 * Popover placement from the design (`menuPlace`): open below the trigger when the menu
 * fits, above when it fits there, otherwise pinned inside the viewport with a scrollable
 * max height. Kept free of DOM types so it can be unit tested.
 */

export interface Rect {
  top: number;
  bottom: number;
  right: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  top?: string;
  bottom?: string;
  right: string;
  maxHeight: string;
}

/** Menu item height: 44px below 720px wide, 36px otherwise. */
const MOBILE_WIDTH = 720;
const ITEM_HEIGHT = { mobile: 44, desktop: 36 } as const;
/** Allowance for separators (4 × 10px) and the menu's padding (20px). */
const CHROME = 4 * 10 + 20;
const EDGE = 12;
const GAP = 4;
const MIN_EDGE = 8;

export function menuPlace(rect: Rect, itemCount: number, viewport: Viewport): Placement {
  const { width, height } = viewport;
  const estimate = itemCount * (width < MOBILE_WIDTH ? ITEM_HEIGHT.mobile : ITEM_HEIGHT.desktop) + CHROME;
  const below = height - rect.bottom - EDGE;
  const above = rect.top - EDGE;
  const right = `${Math.max(MIN_EDGE, width - rect.right)}px`;
  if (estimate <= below) return { top: `${rect.bottom + GAP}px`, right, maxHeight: `${below}px` };
  if (estimate <= above) return { bottom: `${height - rect.top + GAP}px`, right, maxHeight: `${above}px` };
  return { top: `${Math.max(MIN_EDGE, Math.min(rect.bottom + GAP, height - estimate - MIN_EDGE))}px`, right, maxHeight: `${height - 2 * MIN_EDGE}px` };
}

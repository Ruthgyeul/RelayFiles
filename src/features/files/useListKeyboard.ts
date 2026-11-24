"use client";

import type { KeyboardEvent } from "react";
import { gridNavIndex, isListNavKey, listNavIndex } from "@/domain/list-nav";

/**
 * Marks a keyboard stop in a list: an item's name button (its value: the item id), or a leading
 * row's link (Favorites folders, the Favorites entry), which Space leaves alone.
 */
export const NAV_ITEM_ATTR = "data-nav-item";

/**
 * Keys on an item name in the File Manager's list or grid: arrows, Home and End move between
 * items, Space selects (Shift: a range, as with clicks). Enter opens through the button itself.
 */
export function useListKeyboard(view: "list" | "grid", toggle: (id: string, range: boolean) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const id = target.getAttribute(NAV_ITEM_ATTR);
    if (id === null || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " ") {
      // Not a click: Space selects, Enter opens.
      event.preventDefault();
      toggle(id, event.shiftKey);
      return;
    }
    if (!isListNavKey(event.key)) return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(`[${NAV_ITEM_ATTR}]`)];
    const index = stops.indexOf(target);
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const next =
      view === "grid" && vertical
        ? gridNavIndex(stops.length, index, event.key as "ArrowUp" | "ArrowDown", (at) => {
            // Only the cards up to the next row are measured (content-visibility skips the rest).
            const box = stops[at]!.getBoundingClientRect();
            return { left: box.left, top: box.top };
          })
        : listNavIndex(index, event.key, stops.length, view);
    if (next === null) return;
    event.preventDefault();
    stops[next]?.focus();
    stops[next]?.scrollIntoView({ block: "nearest" });
  };
}

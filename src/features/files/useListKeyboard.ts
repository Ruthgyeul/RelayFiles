"use client";

import type { KeyboardEvent } from "react";
import { gridNavIndex, isListNavKey, listNavIndex } from "@/domain/list-nav";

/** Marks an item's name button, the stop of keyboard moves in a list (its value: the item id). */
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
        ? gridNavIndex(
            stops.map((stop) => {
              const box = stop.getBoundingClientRect();
              return { left: box.left, top: box.top };
            }),
            index,
            event.key as "ArrowUp" | "ArrowDown",
          )
        : listNavIndex(index, event.key, stops.length, view);
    if (next === null) return;
    event.preventDefault();
    stops[next]?.focus();
    stops[next]?.scrollIntoView({ block: "nearest" });
  };
}

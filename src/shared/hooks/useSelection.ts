"use client";

import { useState } from "react";
import { rangeBetween } from "@/domain/selection";

/**
 * Checked items of a list: toggle one, select all of `items`, or clear. Ids not in `items` are
 * ignored. `toggle(id, true)` (Shift-click) checks every item from the last one toggled to `id`,
 * in the order `items` are shown.
 */
export function useSelection<T extends { id: string }>(items: readonly T[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  return {
    has: (id: string) => selected.has(id),
    items: items.filter((item) => selected.has(item.id)),
    allSelected,
    toggle: (id: string, range = false) => {
      if (range && anchor !== null) {
        const ids = rangeBetween(items.map((item) => item.id), anchor, id);
        setSelected((current) => new Set([...current, ...ids]));
        return;
      }
      setAnchor(id);
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    selectAll: () => setSelected(new Set(items.map((item) => item.id))),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id))),
    clear: () => (setSelected(new Set()), setAnchor(null)),
    /** The raw set, for drag-and-drop of the checked items. */
    ids: selected,
  };
}

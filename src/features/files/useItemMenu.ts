"use client";

import { useState } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { anchorOf, type AnchorRect } from "./ActionMenu";

/** The action menu of the File Manager: which item (the folder or a listed one) it is open for, and where. */
export function useItemMenu(folder: NodeItem, items: readonly NodeItem[]) {
  const [menu, setMenu] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  /** The current folder or one of its listed items. */
  const itemById = (id: string) => (id === folder.id ? folder : items.find((item) => item.id === id));
  return {
    menu,
    /** The item the menu is open for, while it is still listed. */
    menuItem: menu ? itemById(menu.id) : undefined,
    isOpenFor: (id: string) => menu?.id === id,
    /** Opens the menu at `anchor`, or closes it when it is already open for this item. */
    toggle: (id: string, anchor: HTMLElement) => {
      const rect = anchorOf(anchor);
      setMenu((current) => (current?.id === id ? null : { id, anchor: rect }));
    },
    close: () => setMenu(null),
    /** Runs `run` with the item when it is still listed. */
    withItem: (id: string, run: (item: NodeItem) => void) => {
      const item = itemById(id);
      if (item) run(item);
    },
  };
}

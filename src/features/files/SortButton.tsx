"use client";

import { useState } from "react";
import { THEME_COLOR } from "@/shared/styles/palette";
import { Icon } from "@/shared/ui/icon/Icon";
import { MenuItem, MenuLabel } from "@/shared/ui/Menu";
import { ActionMenu, anchorOf, type AnchorRect } from "./ActionMenu";

/** The sort keys a list offers, with the "SORT BY" menu labels and the short toolbar labels. */
export interface SortOptions<S extends string> {
  keys: readonly S[];
  label: Record<S, string>;
  short: Record<S, string>;
}

/** The toolbar's sort button (short label of the current order) and its "SORT BY" menu. */
export function SortButton<S extends string>({ sort, options, onSort }: { sort: S; options: SortOptions<S>; onSort: (key: S) => void }) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  return (
    <>
      <button
        type="button"
        title="Sort"
        aria-label={`Sort: ${options.short[sort]}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          const next = anchorOf(event.currentTarget);
          setAnchor((open) => (open ? null : next));
        }}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-semibold text-t3 hover:bg-btn"
      >
        <Icon name="arrows-down-up" size={20} />
        <span className="max-sm:hidden">{options.short[sort]}</span>
      </button>
      {anchor && (
        <ActionMenu anchor={anchor} label="Sort" placement="below" onClose={() => setAnchor(null)}>
          <MenuLabel>SORT BY</MenuLabel>
          {options.keys.map((key) => {
            const on = key === sort;
            return (
              <MenuItem
                key={key}
                size="sort"
                icon="check"
                iconColor={on ? THEME_COLOR.accentHi : "transparent"}
                color={on ? THEME_COLOR.accentText : undefined}
                onSelect={() => {
                  setAnchor(null);
                  onSort(key);
                }}
              >
                {options.label[key]}
              </MenuItem>
            );
          })}
        </ActionMenu>
      )}
    </>
  );
}

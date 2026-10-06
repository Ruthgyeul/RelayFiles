"use client";

import type { FilterKey } from "@/domain/tree";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { FILTER_CHIPS } from "./kind";

/** Type filter chips with counts; types without items are hidden unless selected. */
export function FilterBar({ counts, value, onChange }: { counts: Record<FilterKey, number>; value: FilterKey; onChange: (key: FilterKey) => void }) {
  return (
    <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
      {FILTER_CHIPS.filter((chip) => chip.key === "all" || counts[chip.key] > 0 || chip.key === value).map((chip) => {
        const on = chip.key === value;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(chip.key)}
            className={cn("flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold", on ? "border-accent-hi bg-accent-soft text-accent-text" : "border-card-line bg-card text-t2")}
          >
            <Icon name={chip.icon} size={14} style={{ color: on ? "var(--accentText)" : chip.color }} />
            {chip.label}
            <span className="opacity-65">{counts[chip.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

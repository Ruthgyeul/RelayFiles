"use client";

import { Icon } from "@/shared/ui/icon/Icon";

/** Folder search (`/`); a query starting with # searches tags across the account. */
export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex h-[42px] items-center gap-2 rounded-xl border border-ctrl bg-card px-3.5">
      <Icon name="magnifying-glass" className="text-t4" />
      <input
        autoFocus
        data-search-input
        aria-label="Search in this folder"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search in this folder · #tag1 #tag2 for files with all tags"
        className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-t1 outline-none placeholder:text-t5"
      />
    </div>
  );
}

/** Banner above tag search results: "#a + #b · 3 items across all folders". */
export function TagModeBar({ label, count, onClear }: { label: string; count: string; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-accent-soft-line bg-accent-soft py-2.5 pr-3 pl-3.5">
      <Icon name="hash" size={18} className="text-accent-icon" />
      <span className="min-w-40 flex-1 text-[14px] text-t1">
        <b>{label}</b> · {count} across all folders
      </span>
      <button type="button" onClick={onClear} className="flex h-[30px] items-center gap-1.5 rounded-lg border border-ctrl bg-btn px-2.5 text-[12px] font-bold text-t1">
        <Icon name="x" />
        Clear
      </button>
    </div>
  );
}

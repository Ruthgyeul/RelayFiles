"use client";

import type { SortKey } from "@/domain/tree";
import { plural } from "@/domain/format";
import { FILE_SORT_OPTIONS } from "@/features/files/Toolbar";
import { SortButton } from "@/features/files/SortButton";
import type { ViewMode } from "@/features/files/usePrefs";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

interface ShareToolbarProps {
  shown: number;
  total: number;
  view: ViewMode;
  onToggleView: () => void;
  onToggleSearch: () => void;
  sort: SortKey;
  onSort: (key: SortKey) => void;
}

function ToolIcon({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn">
      <Icon name={icon} size={20} />
    </button>
  );
}

/** Above a shared folder's items: how many are shown, list or grid, search and sort. */
export function ShareToolbar({ shown, total, view, onToggleView, onToggleSearch, sort, onSort }: ShareToolbarProps) {
  return (
    <div role="toolbar" aria-label="Items" className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-card-line bg-card px-3 py-2">
      <span className="px-1.5 text-[13px] font-semibold text-t3">{shown === total ? plural(total, "item") : `${shown} of ${plural(total, "item")}`}</span>
      <span className="flex-1" />
      <ToolIcon icon={view === "grid" ? "list-bullets" : "squares-four"} label={view === "grid" ? "List view" : "Grid view"} onClick={onToggleView} />
      <ToolIcon icon="magnifying-glass" label="Search in this folder" onClick={onToggleSearch} />
      <SortButton sort={sort} options={FILE_SORT_OPTIONS} onSort={onSort} />
    </div>
  );
}

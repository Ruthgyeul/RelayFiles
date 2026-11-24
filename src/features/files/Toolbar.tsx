"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SORT_KEYS, SORT_OPTION_LABEL, SORT_SHORT_LABEL, type SortKey } from "@/domain/tree";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { SortButton, type SortOptions } from "./SortButton";
import type { ViewMode } from "./usePrefs";
import { FILES_SUBPAGES } from "@/features/shell/nav";

export type { SortOptions };

/** The File Manager's sort menu. */
export const FILE_SORT_OPTIONS: SortOptions<SortKey> = { keys: SORT_KEYS, label: SORT_OPTION_LABEL, short: SORT_SHORT_LABEL };

interface ToolbarProps<S extends string> {
  allSelected: boolean;
  selectedCount: number;
  onToggleAll: () => void;
  /** Buttons shown while items are selected (Download, Zip, Tags, Favorite, Copy, Move, Rename, Delete). */
  selectionActions: ReactNode;
  /** Buttons shown otherwise (Upload, Upload folder, New folder). */
  folderActions: ReactNode;
  view: ViewMode;
  onToggleView: () => void;
  onToggleSearch: () => void;
  sort: S;
  sortOptions: SortOptions<S>;
  onSort: (key: S) => void;
  onRefresh: () => void;
  /** Accessible name of the search button. */
  searchLabel?: string;
  /** "Shared by me", "Storage" and "Recently deleted" links (File Manager only). */
  links?: boolean;
}

function ToolIcon({ icon, label, onClick, className }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn ${className ?? ""}`}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/** File Manager toolbar card: selection, folder actions, view, search, sort, "Recently deleted" and refresh. */
export function Toolbar<S extends string>(props: ToolbarProps<S>) {
  const { selectedCount, sortOptions, links = true } = props;
  return (
    <div role="toolbar" aria-label="Files" className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-card-line bg-card px-3 py-2 shadow-toolbar">
      <button
        type="button"
        role="checkbox"
        aria-checked={props.allSelected}
        aria-label="Select all"
        onClick={props.onToggleAll}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn"
      >
        <Icon name="check-square" weight={props.allSelected ? "fill" : "regular"} size={20} />
      </button>
      <span aria-hidden className="mx-1 h-[22px] w-px bg-ctrl" />
      {selectedCount > 0 ? (
        <>
          <span className="px-1.5 text-[13px] font-semibold">
            {selectedCount}
            <span className="max-sm:hidden"> selected</span>
          </span>
          {props.selectionActions}
        </>
      ) : (
        props.folderActions
      )}
      <span className="flex-1" />
      <ToolIcon icon={props.view === "grid" ? "list-bullets" : "squares-four"} label={props.view === "grid" ? "List view" : "Grid view"} onClick={props.onToggleView} />
      <ToolIcon icon="magnifying-glass" label={props.searchLabel ?? "Search in this folder"} onClick={props.onToggleSearch} />
      <SortButton sort={props.sort} options={sortOptions} onSort={props.onSort} />
      {links &&
        FILES_SUBPAGES.map((page) => (
          <Link key={page.href} href={page.href} title={page.label} aria-label={page.label} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-t3 no-underline hover:bg-btn hover:text-t3">
            <Icon name={page.icon} size={20} />
          </Link>
        ))}
      <ToolIcon icon="arrows-clockwise" label="Refresh" onClick={props.onRefresh} className="max-sm:hidden" />
    </div>
  );
}

/** Toolbar text button (h32, radius 10, 13px 700) with the label hidden below 720px. */
export function ToolButton({ icon, label, onClick, variant = "secondary", title, danger = false }: { icon: IconName; label: string; onClick: () => void; variant?: "primary" | "secondary"; title?: string; danger?: boolean }) {
  const look = variant === "primary" ? "border-accent bg-accent text-on-accent hover:bg-accent-hi" : `border-ctrl bg-btn hover:bg-btn-h ${danger ? "text-danger-text" : "text-t1"}`;
  return (
    <button type="button" title={title ?? label} onClick={onClick} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-bold ${look}`}>
      <Icon name={icon} size={16} />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

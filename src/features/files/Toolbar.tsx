"use client";

import { useState, type ReactNode } from "react";
import { SORT_KEYS, SORT_OPTION_LABEL, SORT_SHORT_LABEL, type SortKey } from "@/domain/tree";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { MenuItem, MenuLabel } from "@/shared/ui/Menu";
import { ActionMenu, anchorOf, type AnchorRect } from "./ActionMenu";
import type { ViewMode } from "./usePrefs";

interface ToolbarProps {
  allSelected: boolean;
  selectedCount: number;
  onToggleAll: () => void;
  /** Buttons shown while items are selected (Download, Zip, Tags, Copy, Move, Delete). */
  selectionActions: ReactNode;
  /** Buttons shown otherwise (Upload, Upload folder, New folder). */
  folderActions: ReactNode;
  view: ViewMode;
  onToggleView: () => void;
  onToggleSearch: () => void;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  onRefresh: () => void;
}

function ToolIcon({ icon, label, onClick, className }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn ${className ?? ""}`}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/** File Manager toolbar card: selection, folder actions, view, search, sort and refresh. */
export function Toolbar(props: ToolbarProps) {
  const [sortAnchor, setSortAnchor] = useState<AnchorRect | null>(null);
  const { selectedCount } = props;
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
      <ToolIcon icon="magnifying-glass" label="Search in this folder" onClick={props.onToggleSearch} />
      <button
        type="button"
        title="Sort"
        aria-label={`Sort: ${SORT_SHORT_LABEL[props.sort]}`}
        aria-haspopup="menu"
        aria-expanded={sortAnchor !== null}
        onClick={(event) => {
          const anchor = anchorOf(event.currentTarget);
          setSortAnchor((open) => (open ? null : anchor));
        }}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-semibold text-t3 hover:bg-btn"
      >
        <Icon name="arrows-down-up" size={20} />
        <span className="max-sm:hidden">{SORT_SHORT_LABEL[props.sort]}</span>
      </button>
      <ToolIcon icon="arrows-clockwise" label="Refresh" onClick={props.onRefresh} className="max-sm:hidden" />
      {sortAnchor && (
        <ActionMenu anchor={sortAnchor} label="Sort" placement="below" onClose={() => setSortAnchor(null)}>
          <MenuLabel>SORT BY</MenuLabel>
          {SORT_KEYS.map((key) => {
            const on = key === props.sort;
            return (
              <MenuItem
                key={key}
                size="sort"
                icon="check"
                iconColor={on ? "var(--accentHi)" : "transparent"}
                color={on ? "var(--accentText)" : undefined}
                onSelect={() => {
                  setSortAnchor(null);
                  props.onSort(key);
                }}
              >
                {SORT_OPTION_LABEL[key]}
              </MenuItem>
            );
          })}
        </ActionMenu>
      )}
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

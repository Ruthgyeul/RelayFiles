"use client";

import { type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "./icon/Icon";

/** Fixed-position placement computed by the caller (see domain/menu `menuPlace`). */
export interface MenuPlacement {
  top?: string;
  bottom?: string;
  right?: string;
  maxHeight?: string;
}

export interface MenuProps {
  placement?: MenuPlacement;
  /** `md` = file and sort menus (min 200), `sm` = account menu (170 wide). */
  size?: "md" | "sm";
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

/** Moves focus between items with the arrow keys, Home and End. */
function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
  if (event.key === "ArrowDown") focusAt(index + 1);
  else if (event.key === "ArrowUp") focusAt(index - 1);
  else if (event.key === "Home") focusAt(0);
  else if (event.key === "End") focusAt(items.length - 1);
  else return;
  event.preventDefault();
}

/** Popover menu surface: bg elev, 1px ctrl, radius 12, padding 6, popover shadow. */
export function Menu({ placement, size = "md", label, className, style, children }: MenuProps) {
  return (
    <div
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      style={{ ...placement, ...style }}
      className={cn(
        "box-border flex flex-col overflow-auto rounded-xl border border-ctrl bg-elev p-1.5 shadow-popover",
        placement && "fixed z-(--z-popover)",
        size === "md" ? "min-w-[200px]" : "w-[170px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps {
  icon: IconName;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Text color override (e.g. the sort menu's selected option). */
  color?: string;
  /** `md` = 36px (44px on mobile), `sm` = 34px account menu items at 13px, `sort` = 34px at 14px. */
  size?: "md" | "sm" | "sort";
  /** Icon color when it differs from the text (the sort menu's check mark). */
  iconColor?: string;
  trailing?: ReactNode;
  disabled?: boolean;
}

const ITEM_SIZE = { md: "h-11 text-[14px] sm:h-9", sm: "h-[34px] text-[13px]", sort: "h-[34px] text-[14px]" } as const;

export function MenuItem({ icon, children, onSelect, danger = false, color, size = "md", iconColor, trailing, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      style={{ color }}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left font-semibold hover:bg-btn-h disabled:opacity-50",
        ITEM_SIZE[size],
        danger ? "text-danger-text" : !color && "text-t1",
      )}
    >
      <Icon name={icon} size={size === "md" ? 16 : size === "sort" ? 14 : undefined} weight={size === "sort" ? "bold" : undefined} style={iconColor ? { color: iconColor } : undefined} />
      <span className="flex-1">{children}</span>
      {trailing}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1.5 my-1 h-px shrink-0 bg-ctrl" />;
}

/** Small uppercase heading inside a menu (e.g. "SORT BY"). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <span className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-[.06em] text-t4">{children}</span>;
}

"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { menuPlace, type Placement } from "@/domain/menu";
import { useMounted } from "@/shared/hooks/useMounted";
import { useViewport } from "@/shared/hooks/useViewport";
import { BottomSheet } from "@/shared/ui/BottomSheet";
import type { IconName } from "@/shared/ui/icon/Icon";
import { Menu, MenuItem, MenuSeparator } from "@/shared/ui/Menu";

export interface MenuEntry {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  /** Draws a separator above this entry. */
  separator?: boolean;
}

export interface AnchorRect {
  top: number;
  bottom: number;
  right: number;
  /** The button the menu belongs to, to tell whether it has moved since. */
  element?: HTMLElement;
}

export function anchorOf(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, right: rect.right, element };
}

interface ActionMenuProps {
  anchor: AnchorRect;
  label: string;
  onClose: () => void;
  /** Entries for a standard action menu; or pass custom children (sort menu). */
  entries?: MenuEntry[];
  children?: ReactNode;
  /** `auto` = design `menuPlace` (below, above or pinned); `below` = sort menu. */
  placement?: "auto" | "below";
  itemCount?: number;
}

/**
 * Popover menu anchored to a button, with the design's outside-click catcher; closes on
 * Escape, scroll and resize. Below 720px it is a bottom sheet with 44px items that stays
 * open while the page scrolls behind it.
 */
export function ActionMenu({ anchor, label, onClose, entries, children, placement = "auto", itemCount }: ActionMenuProps) {
  const mounted = useMounted();
  const { small } = useViewport();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    // Close when the anchor really moves (the user scrolled or resized), not when rows
    // rendered later shift the page and scroll anchoring keeps the anchor in place.
    const element = anchor.element;
    const start = element?.getBoundingClientRect();
    const onMove = () => {
      const now = element?.getBoundingClientRect();
      if (!start || !now || Math.abs(now.top - start.top) >= 1 || Math.abs(now.left - start.left) >= 1) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Only the anchored popover goes stale when the page moves; the bottom sheet does not.
    if (!small) {
      window.addEventListener("scroll", onMove, { passive: true });
      window.addEventListener("resize", onMove);
    }
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  }, [anchor, onClose, small]);

  const body = entries
    ? entries.map((entry) => (
        <Fragment key={entry.label}>
          {entry.separator && <MenuSeparator />}
          <MenuItem
            icon={entry.icon}
            danger={entry.danger}
            onSelect={() => {
              onClose();
              entry.onSelect();
            }}
          >
            {entry.label}
          </MenuItem>
        </Fragment>
      ))
    : children;

  if (!mounted) return null;
  if (small) {
    return (
      <BottomSheet open onClose={onClose} label={label}>
        {body}
      </BottomSheet>
    );
  }

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const place: Placement =
    placement === "below"
      ? { top: `${anchor.bottom + 4}px`, right: `${viewport.width - anchor.right}px`, maxHeight: `calc(100vh - ${anchor.bottom + 16}px)` }
      : menuPlace(anchor, itemCount ?? entries?.length ?? 0, viewport);

  return createPortal(
    <>
      <div aria-hidden className="fixed inset-0 z-(--z-menu-catcher)" onClick={onClose} />
      <div ref={menu}>
        <Menu label={label} placement={{ top: place.top ?? "auto", bottom: place.bottom ?? "auto", right: place.right, maxHeight: place.maxHeight }}>
          {body}
        </Menu>
      </div>
    </>,
    document.body,
  );
}

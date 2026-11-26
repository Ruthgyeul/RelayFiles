import type { DragEvent } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { formatSize } from "@/domain/format";
import { itemCount } from "@/domain/tree";
import type { DropTargetProps } from "./useDragMove";

/** What a row or card of the File Manager list gets for one item. */
export interface ItemProps {
  item: NodeItem;
  /** Folder path shown before the meta in tag search results. */
  parentPath?: string;
  parentVisibility: "private" | "public";
  selected: boolean;
  now: number;
  /** Checks or unchecks the item; `range` (Shift held) checks everything from the last one toggled. */
  onToggle: (range?: boolean) => void;
  onPrimary: () => void;
  /** Opens a file in the viewer (thumbnails, "Open viewer"). */
  onPreview: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onTag: (tag: string) => void;
  menuOpen: boolean;
  /** Drag source props (desktop drag-to-move). */
  drag?: { draggable: true; onDragStart: (event: DragEvent) => void; onDragEnd: () => void };
  /** Drop target props for folders. */
  drop?: DropTargetProps;
  /** A dragged item is over this folder. */
  dropOver?: boolean;
  /** Long lists: skip rendering while off screen (content-visibility). */
  lazy?: boolean;
}

/**
 * What a grid card shows: no settings tags, so not the clock (`now`, which ticks every half
 * minute), the inherited visibility or the tag handler. Leaving them out keeps memoized cards
 * from rendering again on every tick.
 */
export type CardProps = Omit<ItemProps, "now" | "parentVisibility" | "onTag">;

export function cardProps(props: ItemProps): CardProps {
  const { item, parentPath, selected, onToggle, onPrimary, onPreview, onMenu, menuOpen, drag, drop, dropOver, lazy } = props;
  return { item, parentPath, selected, onToggle, onPrimary, onPreview, onMenu, menuOpen, drag, drop, dropOver, lazy };
}

/** "3 items" for folders, the size for files, prefixed with the folder path in tag search. */
export function itemMeta(item: NodeItem, parentPath?: string): string {
  const own = item.type === "folder" ? itemCount(item.itemCount) : formatSize(Number(item.size));
  return parentPath ? `${parentPath} · ${own}` : own;
}

/** An item's name as a button (the list's keyboard stop), looking like the plain name it replaces. */
export const NAME_BUTTON = "min-w-0 truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] text-t1";

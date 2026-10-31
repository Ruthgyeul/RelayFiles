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
  onToggle: () => void;
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

/** "3 items" for folders, the size for files, prefixed with the folder path in tag search. */
export function itemMeta(item: NodeItem, parentPath?: string): string {
  const own = item.type === "folder" ? itemCount(item.itemCount) : formatSize(Number(item.size));
  return parentPath ? `${parentPath} · ${own}` : own;
}

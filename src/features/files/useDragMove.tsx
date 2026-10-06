"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { hasFiles } from "@/features/transfers/read-drop";
import { Icon } from "@/shared/ui/icon/Icon";

/** Props spread onto an element that accepts dropped items (folder rows, crumbs, the Up button). */
export interface DropTargetProps {
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

interface DragMove {
  /** Starts dragging an item; a selected item drags the whole selection. */
  dragProps: (id: string, name: string) => { draggable: true; onDragStart: (event: DragEvent) => void; onDragEnd: () => void };
  /** Drop handlers for a folder; returns undefined for folders being dragged. */
  dropProps: (folderId: string) => DropTargetProps | undefined;
  /** Folder currently under the pointer. */
  over: string | null;
  pill: ReactNode;
}

/**
 * Drag-to-move from the design: dragging shows a "Moving N items" pill; dropping on a
 * folder, a crumb or the Up button moves the items there. Touch devices use Move instead.
 */
export function useDragMove(
  selected: ReadonlySet<string>,
  onMove: (ids: string[], targetId: string) => void,
  /** Files dropped from the operating system onto a folder are uploaded there. */
  onFiles?: (folderId: string, transfer: DataTransfer) => void,
): DragMove {
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const end = () => {
    setDragging(null);
    setOver(null);
  };

  return {
    dragProps: (id, name) => ({
      draggable: true,
      onDragStart: (event) => {
        setDragging(selected.has(id) ? [...selected] : [id]);
        event.dataTransfer.setData("text/plain", name);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: end,
    }),
    dropProps: (folderId) => {
      if (dragging?.includes(folderId)) return undefined;
      return {
        onDragOver: (event) => {
          if (!dragging && !(onFiles && hasFiles(event.dataTransfer))) return;
          event.preventDefault();
          event.stopPropagation();
          setOver(folderId);
        },
        onDragLeave: (event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOver((current) => (current === folderId ? null : current));
        },
        onDrop: (event) => {
          const ids = dragging;
          if (!ids && !(onFiles && hasFiles(event.dataTransfer))) return;
          event.preventDefault();
          event.stopPropagation();
          end();
          if (ids) onMove(ids, folderId);
          else onFiles?.(folderId, event.dataTransfer);
        },
      };
    },
    over,
    pill:
      dragging ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-(--z-moving-pill) flex -translate-x-1/2 items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-[13px] font-bold whitespace-nowrap text-on-accent shadow-popover">
          <Icon name="arrows-out-cardinal" />
          Moving {dragging.length} {dragging.length === 1 ? "item" : "items"} · drop on a folder, or on ← to move up
        </div>
      ) : null,
  };
}

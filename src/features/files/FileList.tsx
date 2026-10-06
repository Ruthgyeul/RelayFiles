"use client";

import { useState, type ReactNode } from "react";
import { hasFiles } from "@/features/transfers/read-drop";
import { cn } from "@/shared/lib/cn";
import { EmptyFolder, NodeCard } from "./NodeCard";
import { NodeRow, RowButton, type ItemProps } from "./NodeRow";
import type { ListedItem } from "./useFolderItems";

interface FileListProps {
  items: ListedItem[];
  view: "list" | "grid";
  itemProps: (item: ListedItem) => ItemProps;
  emptyTitle: string;
  emptyActions: ReactNode;
  onOpen: (item: ListedItem) => void;
  onDownload: (item: ListedItem) => void;
  /** Files dropped from the computer onto the list (not onto a folder row). */
  onDropFiles: (transfer: DataTransfer) => void;
}

/** The items of a folder as rows or cards, and a drop zone for files from the computer. */
export function FileList({ items, view, itemProps, emptyTitle, emptyActions, onOpen, onDownload, onDropFiles }: FileListProps) {
  const [filesOver, setFilesOver] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setFilesOver(true);
      }}
      onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setFilesOver(false)}
      onDrop={(event) => {
        setFilesOver(false);
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        onDropFiles(event.dataTransfer);
      }}
      className={cn("flex flex-col gap-px overflow-hidden rounded-2xl border bg-card-line", filesOver ? "border-accent-hi" : "border-card-line")}
    >
      {items.length === 0 ? (
        <EmptyFolder title={emptyTitle} actions={emptyActions} />
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3 bg-card p-3.5">
          {items.map((item) => (
            <NodeCard key={item.id} {...itemProps(item)} />
          ))}
        </div>
      ) : (
        items.map((item) => (
          <NodeRow
            key={item.id}
            {...itemProps(item)}
            actions={
              <>
                {item.type === "folder" ? <RowButton icon="folder-open" label="Open" onClick={() => onOpen(item)} /> : <RowButton icon="eye" label="Preview" onClick={() => onOpen(item)} />}
                <RowButton icon="download-simple" label="Download" onClick={() => onDownload(item)} />
              </>
            }
          />
        ))
      )}
    </div>
  );
}

"use client";

import type { DragEvent, ReactNode } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { formatClock, formatDateTime, formatSize } from "@/domain/format";
import { itemCount, settingTags } from "@/domain/tree";
import { useResume } from "@/features/viewer/useResume";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Tag } from "@/shared/ui/Tag";
import { kindOf } from "./kind";
import { MediaThumb } from "./MediaThumb";
import { toShareSettings } from "./settings";
import type { DropTargetProps } from "./useDragMove";

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
}

/** "3 items" for folders, the size for files, prefixed with the folder path in tag search. */
export function itemMeta(item: NodeItem, parentPath?: string): string {
  const own = item.type === "folder" ? itemCount(item.itemCount) : formatSize(Number(item.size));
  return parentPath ? `${parentPath} · ${own}` : own;
}

/** Row button: 40px tap target below 720px (label hidden), 30px with label above. */
export function RowButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="box-border flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-2.5 text-[13px] font-bold text-t1 hover:bg-btn-h sm:h-[30px] sm:min-w-[30px]"
    >
      <Icon name={icon} size={15} />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

export function MenuButton({ label, open, onMenu, className }: { label: string; open: boolean; onMenu: (anchor: HTMLElement) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onMenu(event.currentTarget);
      }}
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn sm:size-[30px]", className)}
    >
      <Icon name="dots-three-vertical" weight="bold" size={16} />
    </button>
  );
}

/** "1:12 / 4:05" when a video or audio file has a saved position (design `resumeText`). */
function ResumeMeta({ id }: { id: string }) {
  const point = useResume(id);
  if (!point) return null;
  return (
    <span className="flex items-center gap-1 text-accent-text">
      <Icon name="play-circle" weight="fill" />
      {formatClock(point.t)} / {formatClock(point.d)}
    </span>
  );
}

/** User tags (clickable, start a tag search) followed by setting tags, without "Password" (shown as a lock). */
function RowTags({ item, parentVisibility, now, onTag }: Pick<ItemProps, "item" | "parentVisibility" | "now" | "onTag">) {
  const settings = settingTags(toShareSettings(item.settings), item.downloads, parentVisibility, now).filter((tag) => tag.icon !== "lock-simple");
  if (item.tags.length === 0 && settings.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {item.tags.map((tag) => (
        <Tag
          key={`#${tag}`}
          size="sm"
          icon="hash"
          title={tag}
          className="cursor-pointer"
          onClick={(event) => {
            event.stopPropagation();
            onTag(tag);
          }}
        >
          {tag}
        </Tag>
      ))}
      {settings.map((tag) => (
        <Tag key={tag.label} size="sm" icon={tag.icon}>
          {tag.label}
        </Tag>
      ))}
    </div>
  );
}

/** One list row: checkbox, type icon (with folder count), name, meta, tags and actions. */
export function NodeRow({ item, parentPath, parentVisibility, selected, now, onToggle, onPrimary, onPreview, onMenu, onTag, menuOpen, drag, drop, dropOver, actions }: ItemProps & { actions: ReactNode }) {
  const kind = kindOf(item);
  const folder = item.type === "folder";
  const { small } = useViewport();
  const thumb = !small && (item.kind === "video" || item.kind === "image");
  return (
    <div
      {...drag}
      {...drop}
      data-item={item.name}
      className={cn("relative flex flex-col gap-2.5 px-4 py-3 -outline-offset-2", dropOver ? "bg-accent-soft outline-2 outline-accent-hi outline-dashed" : "bg-card")}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${item.name}`}
          onClick={onToggle}
          className="flex size-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 sm:size-[30px]"
        >
          <Icon name={selected ? "check-square" : "square"} weight={selected ? "fill" : "regular"} size={22} className={selected ? "text-accent-hi" : "text-t5"} />
        </button>
        <div className="relative flex w-9 shrink-0 justify-center">
          <Icon name={kind.icon} weight={folder ? "fill" : "regular"} size={28} style={{ color: kind.color }} />
          {folder && (
            <span className="absolute -right-0.5 -bottom-1 box-border flex h-4 min-w-4 items-center justify-center rounded-lg border border-card bg-btn px-[3px] text-[10px] font-bold">{item.itemCount}</span>
          )}
        </div>
        <div onClick={onPrimary} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px]">
          <span className="flex items-center gap-1.5 truncate text-[15px] font-bold">
            <span className="truncate">{item.name}</span>
            {item.settings.hasPassword && <Icon name="lock-simple" size={13} label="Password protected" className="text-t4" />}
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-t4">
            <span className="flex items-center gap-[5px]">
              <Icon name="calendar-blank" />
              <LocalDate value={item.createdAt} format={formatDateTime} />
            </span>
            <span>{itemMeta(item, parentPath)}</span>
            {!folder && (
              <span className="flex items-center gap-1" title="Downloads">
                <Icon name="download-simple" />
                {item.downloads}
              </span>
            )}
            {!folder && <ResumeMeta id={item.id} />}
          </div>
          <RowTags item={item} parentVisibility={parentVisibility} now={now} onTag={onTag} />
        </div>
        {actions}
        <MenuButton label={`Actions for ${item.name}`} open={menuOpen} onMenu={onMenu} />
      </div>
      {thumb && (
        <div className="pl-[92px] max-sm:hidden">
          <div onClick={onPreview} className="relative flex aspect-square w-[min(288px,100%)] cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-card-line bg-black">
            <MediaThumb item={item} variant="row" onOpen={onPreview} />
          </div>
        </div>
      )}
    </div>
  );
}

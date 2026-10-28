"use client";

import type { ReactNode } from "react";
import { formatClock, formatDateTime } from "@/domain/format";
import { settingTags } from "@/domain/tree";
import { FILES } from "@/config/policy";
import { previewKindOf } from "@/domain/media";
import { ListPreview } from "@/features/viewer/ListPreview";
import { useResume } from "@/features/viewer/useResume";
import { cn } from "@/shared/lib/cn";
import { BusyPill } from "@/shared/ui/BusyPill";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Tag } from "@/shared/ui/Tag";
import { fileUrls } from "@/shared/lib/files-api";
import { kindOf } from "@/shared/ui/node-kind";
import { toShareSettings } from "./settings";
import { MenuButton } from "./ItemButtons";
import { itemMeta, type ItemProps } from "./item-props";

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
export function NodeRow({ item, parentPath, parentVisibility, selected, now, onToggle, onPrimary, onPreview, onMenu, onTag, menuOpen, drag, drop, dropOver, lazy, actions }: ItemProps & { actions: ReactNode }) {
  const kind = kindOf(item);
  const folder = item.type === "folder";
  const preview = previewKindOf(item.type, item.kind);
  return (
    <div
      {...drag}
      {...drop}
      data-item={item.name}
      className={cn(
        "relative flex flex-col gap-2.5 px-4 py-3 -outline-offset-2",
        dropOver ? "bg-accent-soft outline-2 outline-accent-hi outline-dashed" : "bg-card",
        lazy && "[content-visibility:auto]",
      )}
      style={lazy ? { containIntrinsicSize: `auto ${preview ? FILES.previewRowEstimatePx : FILES.rowEstimatePx}px` } : undefined}
    >
      {/* Phones: the row buttons move under the name so it keeps the width (menu stays on top). */}
      <div className="flex items-center gap-3 max-sm:flex-wrap">
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
            {item.busy && <BusyPill busy={item.busy} />}
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
        <div className="flex shrink-0 items-center gap-3 max-sm:order-last max-sm:w-full max-sm:pl-[88px]">{actions}</div>
        <MenuButton label={`Actions for ${item.name}`} open={menuOpen} onMenu={onMenu} />
      </div>
      {preview && (
        <ListPreview
          id={item.id}
          name={item.name}
          kind={preview}
          src={fileUrls.stream(item.id)}
          thumbSrc={item.hasThumb ? fileUrls.thumb(item.id) : null}
          previewSrc={fileUrls.preview(item.id)}
          transcodeSrc={fileUrls.transcode(item.id)}
          loadOriginal
          onOpen={onPreview}
          className="sm:pl-[92px]"
        />
      )}
    </div>
  );
}

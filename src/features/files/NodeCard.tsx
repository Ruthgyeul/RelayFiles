"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { kindOf } from "./kind";
import { MediaThumb, ResumeBar } from "./MediaThumb";
import { itemMeta, MenuButton, type ItemProps } from "./NodeRow";

/** Grid card: 4:3 preview area with the type icon, corner checkbox, name, meta and menu. */
export function NodeCard({ item, parentPath, selected, onToggle, onPrimary, onPreview, onMenu, menuOpen, drag, drop, dropOver }: ItemProps) {
  const kind = kindOf(item);
  const media = item.kind === "video" || item.kind === "image";
  return (
    <div
      {...drag}
      {...drop}
      data-item={item.name}
      className={cn("relative flex flex-col overflow-hidden rounded-xl border", dropOver ? "bg-accent-soft" : "bg-sunk", dropOver || selected ? "border-accent-hi" : "border-card-line")}
    >
      <div onClick={onPrimary} className="relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden bg-bg">
        {media ? (
          <MediaThumb item={item} variant="card" onOpen={onPreview} />
        ) : (
          <>
            <Icon name={kind.icon} weight={item.type === "folder" ? "fill" : "regular"} size={48} style={{ color: kind.color }} />
            {item.kind === "audio" && <ResumeBar id={item.id} />}
          </>
        )}
      </div>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${item.name}`}
        onClick={onToggle}
        className="absolute top-1.5 left-1.5 flex size-[30px] items-center justify-center rounded-lg border-0 bg-grid-check p-0"
      >
        <Icon name={selected ? "check-square" : "square"} weight={selected ? "fill" : "regular"} size={18} className={selected ? "text-accent-hi" : "text-t5"} />
      </button>
      <div className="flex items-center gap-1 py-2.5 pr-1.5 pl-3">
        <div onClick={onPrimary} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
          <span className="flex items-center gap-[5px] text-[14px] font-bold">
            <span className="truncate">{item.name}</span>
            {item.settings.hasPassword && <Icon name="lock-simple" size={12} label="Password protected" className="text-t4" />}
          </span>
          <span className="truncate text-[12px] text-t4">{itemMeta(item, parentPath)}</span>
        </div>
        <MenuButton label={`Actions for ${item.name}`} open={menuOpen} onMenu={onMenu} />
      </div>
    </div>
  );
}

/** Empty list state with the design's five titles and the folder actions. */
export function EmptyFolder({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 bg-card px-4 py-12 text-center">
      <span className="mb-1.5 flex size-14 items-center justify-center rounded-[14px] border border-ctrl bg-btn">
        <Icon name="folder-open" size={26} className="text-t4" />
      </span>
      <span className="text-[16px] font-bold">{title}</span>
      <span className="text-[13px] text-t4">Upload files or create a subfolder to get started.</span>
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </div>
  );
}

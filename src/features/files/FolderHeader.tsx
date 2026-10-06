"use client";

import Link from "next/link";
import type { FolderView } from "@/contracts/nodes";
import { formatDateTime } from "@/domain/format";
import { itemCount, settingTags, visibilityTag } from "@/domain/tree";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Tag } from "@/shared/ui/Tag";
import { folderHref } from "./paths";
import { toShareSettings } from "./settings";
import type { DropTargetProps } from "./useDragMove";

interface FolderHeaderProps {
  view: FolderView;
  now: number;
  onShare: () => void;
  /** Opens the visitor view of this folder's link. */
  onSharePage: () => void;
  onMenu: (anchor: HTMLElement) => void;
  menuOpen: boolean;
  /** Drop on the Up button moves dragged items to the parent folder. */
  upDrop?: DropTargetProps;
  upOver?: boolean;
}

/** Header card of the current folder: up button, icon, name, date, item count, setting tags, note. */
export function FolderHeader({ view, now, onShare, onSharePage, onMenu, menuOpen, upDrop, upOver }: FolderHeaderProps) {
  const { folder, isRoot, path, effectiveVisibility } = view;
  const parent = path.at(-2);
  const tags: { icon: IconName; label: string }[] = [
    ...(isRoot ? [{ icon: "hard-drives" as const, label: "root folder" }] : []),
    visibilityTag(folder.settings.visibility, effectiveVisibility, isRoot),
    ...settingTags(toShareSettings(folder.settings), folder.downloads, null, now).filter((tag) => tag.label !== "Public" && tag.label !== "Private"),
  ];

  return (
    <section aria-label="Folder" className="flex flex-col gap-2.5 rounded-2xl border border-card-line bg-card px-5 py-[18px]">
      <div className="flex items-start gap-3.5">
        {parent && (
          <Link
            {...upDrop}
            href={folderHref(parent.id, path.length === 2)}
            title="Up · drop here to move to parent folder"
            aria-label="Parent folder"
            className={cn(
              "mt-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-t3 hover:bg-btn hover:text-t3",
              upOver && "bg-accent-soft outline-2 outline-accent-hi outline-dashed",
            )}
          >
            <Icon name="arrow-left" size={20} />
          </Link>
        )}
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl border border-ctrl", isRoot ? "bg-accent-soft" : "bg-btn")}>
          {isRoot ? <Icon name="hard-drives" size={24} className="text-accent-icon" /> : <Icon name="folder-open" weight="fill" size={24} className="text-kind-folder" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[20px] font-bold">{folder.name}</span>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-t4">
            <span className="flex items-center gap-[5px]">
              <Icon name="calendar-blank" />
              <LocalDate value={folder.createdAt} format={formatDateTime} />
            </span>
            <span className="flex items-center gap-[5px]">
              <Icon name="copy" />
              {itemCount(folder.itemCount)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Tag key={tag.label} icon={tag.icon}>
                {tag.label}
              </Tag>
            ))}
          </div>
        </div>
        <Button size={34} icon="globe-simple" iconSize={16} hoverable hideLabelOnMobile title="Open share page" onClick={onSharePage} className="px-3">
          Share page
        </Button>
        <Button size={34} icon="share-network" iconSize={16} hoverable hideLabelOnMobile onClick={onShare} className="px-3">
          Share
        </Button>
        <button
          type="button"
          aria-label="Folder menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu(event.currentTarget)}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn"
        >
          <Icon name="dots-three-vertical" weight="bold" size={18} />
        </button>
      </div>
      {folder.settings.note && (
        <div className="flex gap-2 rounded-[10px] bg-sunk px-3 py-2.5 text-[14px] text-t2">
          <Icon name="note" className="mt-0.5 text-t4" />
          {folder.settings.note}
        </div>
      )}
    </section>
  );
}

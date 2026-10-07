"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ShareItem } from "@/contracts/share";
import { formatSize } from "@/domain/format";
import { previewKindOf } from "@/domain/media";
import { KIND_LABEL } from "@/domain/share";
import { itemCount } from "@/domain/tree";
import { kindOf } from "@/features/files/kind";
import { ListPreview } from "@/features/viewer/ListPreview";
import { BusyPill } from "@/shared/ui/BusyPill";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

const rowButton = "flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-bold";

function RowAction({ icon, label, onClick, href, accent, fill }: { icon: IconName; label: string; onClick?: () => void; href?: Route; accent?: boolean; fill?: boolean }) {
  const look = accent ? "border-accent-soft-line bg-accent-soft text-accent-text" : "border-ctrl bg-btn text-t1";
  const content = (
    <>
      <Icon name={icon} weight={fill ? "fill" : "regular"} />
      <span className="max-sm:hidden">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} aria-label={label} className={`${rowButton} ${look} hover:text-t1`}>
      {content}
    </Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={`${rowButton} ${look}`}>
      {content}
    </button>
  );
}

interface ShareRowsProps {
  items: ShareItem[];
  /** Playback and preview URLs of a file in this link. */
  urls: { stream: (id: string) => string; thumb: (id: string) => string };
  folderHref: (folderId: string) => Route;
  onOpen: (item: ShareItem) => void;
  onDownload: (item: ShareItem) => void;
}

/** The list on an open share page (design `shItems`): icon, name, meta, busy badge, actions. */
export function ShareRows({ items, urls, folderHref, onOpen, onDownload }: ShareRowsProps) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-card-line bg-card-line">
      {items.map((item) => {
        const folder = item.type === "folder";
        const kind = kindOf({ type: item.type, kind: item.kind });
        const meta = folder ? itemCount(item.itemCount) : `${formatSize(Number(item.size))} · ${KIND_LABEL[item.kind ?? "other"]}`;
        const playable = !folder && item.kind !== null && item.kind !== "other";
        const preview = previewKindOf(item.type, item.kind);
        const nameBlock = (
          <>
            <span className="truncate text-[15px] font-bold">{item.name}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-t4">{meta}</span>
              {item.busy && <BusyPill busy={item.busy} />}
            </div>
          </>
        );
        return (
          <div key={item.id} data-item={item.name} className="flex flex-col gap-2.5 bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex w-9 shrink-0 justify-center">
                <Icon name={kind.icon} weight={folder ? "fill" : "regular"} size={28} style={{ color: kind.color }} />
              </div>
              {folder ? (
                <Link href={folderHref(item.id)} className="flex min-w-0 flex-1 flex-col gap-[3px] text-t1 hover:text-t1">
                  {nameBlock}
                </Link>
              ) : (
                <div onClick={() => onOpen(item)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px]">
                  {nameBlock}
                </div>
              )}
              {folder && <RowAction icon="folder-open" label="Open" href={folderHref(item.id)} />}
              {playable && <RowAction icon={item.kind === "image" ? "eye" : "play"} label={item.kind === "image" ? "View" : "Play"} onClick={() => onOpen(item)} accent fill />}
              {item.canDownload && <RowAction icon="download-simple" label="Download" onClick={() => onDownload(item)} />}
            </div>
            {preview && (
              <ListPreview
                id={item.id}
                name={item.name}
                kind={preview}
                src={urls.stream(item.id)}
                thumbSrc={item.hasThumb ? urls.thumb(item.id) : null}
                loadOriginal={false}
                onOpen={() => onOpen(item)}
                className="sm:pl-12"
              />
            )}
          </div>
        );
      })}
      {items.length === 0 && <div className="bg-card px-4 py-10 text-center text-[14px] text-t4">This folder is empty.</div>}
    </div>
  );
}

"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ShareItem } from "@/contracts/share";
import { formatSize } from "@/domain/format";
import { itemCount } from "@/domain/tree";
import { BusyPill } from "@/shared/ui/BusyPill";
import { Icon } from "@/shared/ui/icon/Icon";
import { kindOf } from "@/shared/ui/node-kind";

interface ShareGridProps {
  items: ShareItem[];
  thumbUrl: (id: string) => string;
  folderHref: (folderId: string) => Route;
  onOpen: (item: ShareItem) => void;
}

/** Grid view of a shared folder: 4:3 preview (thumbnail or type icon), name and size; folders open, files open in the viewer. */
export function ShareGrid({ items, thumbUrl, folderHref, onOpen }: ShareGridProps) {
  return (
    <ul aria-label="Items" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3 rounded-2xl border border-card-line bg-card p-3.5">
      {items.map((item) => {
        const kind = kindOf(item);
        const folder = item.type === "folder";
        const body = (
          <>
            <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-bg">
              {item.hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- a thumbnail served by the share API, sized by the card
                <img src={thumbUrl(item.id)} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <Icon name={kind.icon} weight={folder ? "fill" : "regular"} size={48} style={{ color: kind.color }} />
              )}
              {item.hasThumb && item.kind === "video" && (
                <span className="absolute flex size-10 items-center justify-center rounded-full bg-overlay-dark">
                  <Icon name="play" weight="fill" size={18} className="text-white" />
                </span>
              )}
            </span>
            <span className="flex flex-col gap-0.5 px-3 py-2.5 text-left">
              <span className="flex items-center gap-[5px] text-[14px] font-bold text-t1">
                <span className="truncate">{item.name}</span>
                {item.busy && <BusyPill busy={item.busy} />}
              </span>
              <span className="truncate text-[12px] text-t4">{folder ? itemCount(item.itemCount) : formatSize(Number(item.size))}</span>
            </span>
          </>
        );
        const look = "flex w-full flex-col overflow-hidden rounded-xl border border-card-line bg-sunk p-0 no-underline";
        return (
          <li key={item.id} data-item={item.name}>
            {folder ? (
              <Link href={folderHref(item.id)} aria-label={`Open ${item.name}`} className={look}>
                {body}
              </Link>
            ) : (
              <button type="button" aria-label={`Open ${item.name}`} onClick={() => onOpen(item)} className={`${look} cursor-pointer`}>
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

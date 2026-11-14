"use client";

import Link from "next/link";
import type { TimelineItem } from "@/contracts/timeline";
import { formatLongDate } from "@/domain/format";
import { MediaPreview } from "@/features/viewer/MediaPreview";
import { fileUrls } from "@/shared/lib/files-api";
import { folderHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";

/** One photo or video of the timeline: the grid card of the File Manager, with its date. */
export function PhotoTile({ item, onOpen }: { item: TimelineItem; onOpen: () => void }) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-card-line bg-sunk [contain-intrinsic-size:auto_220px] [content-visibility:auto]">
      <div onClick={onOpen} className="relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden bg-bg">
        <MediaPreview
          id={item.id}
          name={item.name}
          kind={item.kind}
          src={fileUrls.stream(item.id)}
          thumbSrc={item.hasThumb ? fileUrls.thumb(item.id) : null}
          previewSrc={fileUrls.preview(item.id)}
          transcodeSrc={fileUrls.transcode(item.id)}
          variant="card"
          loadOriginal
          onOpen={onOpen}
        />
      </div>
      <div className="flex items-center gap-1 py-2.5 pr-1.5 pl-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent p-0 text-left text-inherit">
          <span className="truncate text-[14px] font-bold">{item.name}</span>
          <span className="text-[12px] text-t4" title={item.dated ? "When it was taken" : "File date (no date taken in the file)"}>
            {formatLongDate(item.date)}
          </span>
        </button>
        <Link
          href={folderHref(item.parentId, item.parentIsRoot)}
          title="Show in folder"
          aria-label={`Show ${item.name} in its folder`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-t3 no-underline hover:bg-btn hover:text-t3"
        >
          <Icon name="folder-open" size={20} />
        </Link>
      </div>
    </div>
  );
}

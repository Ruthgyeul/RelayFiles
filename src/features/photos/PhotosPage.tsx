"use client";

import { useMemo } from "react";
import type { TimelinePage } from "@/contracts/timeline";
import { groupByMonth } from "@/domain/timeline";
import { useFileMedia } from "@/features/files/useFileMedia";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/Display";
import { PhotoTile } from "./PhotoTile";
import { usePhotoTimeline } from "./usePhotoTimeline";

/** "Photos": every photo and video of the account by month, newest first, opened in the viewer. */
export function PhotosPage({ initial }: { initial: TimelinePage }) {
  usePageTitle("Photos");
  const timeline = usePhotoTimeline(initial);
  // The viewer steps through everything loaded so far, in the timeline's order.
  const listed = useMemo(() => timeline.items.map((item) => ({ ...item, type: "file" as const, fileCount: 1 })), [timeline.items]);
  const media = useFileMedia(listed, "Photos");
  const months = useMemo(() => groupByMonth(timeline.items, Intl.DateTimeFormat().resolvedOptions().timeZone), [timeline.items]);

  return (
    <div className="flex flex-col gap-4">
      {months.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-card-line">
          <EmptyState icon="image" title="No photos or videos yet." description="Photos and videos you upload show up here by the date they were taken." />
        </div>
      ) : (
        months.map((month) => (
          <section key={month.key} aria-label={month.label} className="flex flex-col gap-3 rounded-2xl border border-card-line bg-card p-3.5">
            <h2 className="m-0 px-0.5 text-[17px] font-bold">{month.label}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3">
              {month.items.map((item) => (
                <PhotoTile key={item.id} item={item} onOpen={() => media.preview({ ...item, type: "file", fileCount: 1 })} />
              ))}
            </div>
          </section>
        ))
      )}
      {timeline.status === "error" && <p className="m-0 text-center text-[13px] text-t4">Couldn&apos;t load more photos.</p>}
      {timeline.hasMore && (
        <Button size={36} hoverable disabled={timeline.status === "loading"} onClick={timeline.loadMore} className="self-center">
          {timeline.status === "error" ? "Try again" : "Load more"}
        </Button>
      )}
      {media.viewer}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { resumeStore } from "@/features/viewer/resume";
import { useResume } from "@/features/viewer/useResume";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { fileUrls } from "./api";

const PERCENT = 100;

/** Thin progress bar for a saved playback position (design `resumePct`). */
export function ResumeBar({ id }: { id: string }) {
  const point = useResume(id);
  if (!point) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-track-light">
      <div className="h-1 bg-accent" style={{ width: `${Math.min(PERCENT, (point.t / point.d) * PERCENT).toFixed(1)}%` }} />
    </div>
  );
}

interface MediaThumbProps {
  item: NodeItem;
  /** `row` = 288px square preview under a list row, `card` = 4:3 grid preview. */
  variant: "row" | "card";
  onOpen: () => void;
}

/**
 * Preview of a video or image (design list/grid thumbnails): videos show their first frame
 * and can play right here; "Open viewer" continues in the viewer at the same position.
 */
export function MediaThumb({ item, variant, onOpen }: MediaThumbProps) {
  const [playing, setPlaying] = useState(false);
  const src = fileUrls.stream(item.id);
  const fit = variant === "row" ? "object-contain" : "object-cover";
  // The worker's small WebP preview when it exists; otherwise the original (first frame for videos).
  const still = item.hasThumb ? (
    // eslint-disable-next-line @next/next/no-img-element -- user media is served with auth cookies, not optimizable by next/image
    <img src={fileUrls.thumb(item.id)} alt="" loading="lazy" className={cn("size-full", item.kind === "image" ? "object-cover" : fit)} />
  ) : null;

  if (item.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- see above
    return still ?? <img src={src} alt="" loading="lazy" className="size-full object-cover" />;
  }
  if (playing) {
    return (
      <>
        <video
          src={src}
          controls
          autoPlay
          playsInline
          onClick={(event) => event.stopPropagation()}
          onTimeUpdate={(event) => resumeStore.track(item.id, event.currentTarget)}
          onPause={(event) => resumeStore.track(item.id, event.currentTarget)}
          onLoadedMetadata={(event) => resumeStore.restore(item.id, event.currentTarget)}
          className="block size-full bg-black object-contain"
        />
        <button
          type="button"
          title="Open viewer"
          aria-label="Open viewer"
          onClick={(event) => {
            event.stopPropagation();
            const video = event.currentTarget.parentElement?.querySelector("video");
            if (video) resumeStore.track(item.id, video);
            setPlaying(false);
            onOpen();
          }}
          className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-lg border-0 bg-overlay-dark p-0 text-white"
        >
          <Icon name="corners-out" size={16} />
        </button>
      </>
    );
  }
  return (
    <>
      {still ?? <video src={src} preload="metadata" muted={variant === "card"} playsInline className={cn("size-full", fit)} />}
      <button
        type="button"
        title="Play here"
        aria-label={`Play ${item.name} here`}
        onClick={(event) => {
          event.stopPropagation();
          setPlaying(true);
        }}
        className={cn(
          "absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-overlay-dark p-0 hover:bg-accent",
          variant === "row" ? "size-12" : "size-10",
        )}
      >
        <Icon name="play" weight="fill" size={variant === "row" ? 20 : 16} className="text-white" />
      </button>
      <ResumeBar id={item.id} />
    </>
  );
}

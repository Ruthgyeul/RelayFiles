"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { resumeStore } from "./resume";
import { useResume } from "./useResume";

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

export interface MediaPreviewProps {
  /** Node id (keys the saved playback position). */
  id: string;
  name: string;
  kind: "image" | "video";
  /** The file itself (owner stream or share stream URL). */
  src: string;
  /** The worker's WebP preview, when it exists. */
  thumbSrc: string | null;
  /** `row` = square preview under a list row, `card` = 4:3 grid preview. */
  variant: "row" | "card";
  /**
   * Without a thumbnail, load the file itself for the picture (owner lists). Share pages
   * pass false: fetching a visitor's file just to draw the list would count as a view.
   */
  loadOriginal: boolean;
  onOpen: () => void;
}

/**
 * Picture of an image or video (design list/grid thumbnails): videos show a frame and can
 * play right here; "Open viewer" continues in the viewer at the same position.
 */
export function MediaPreview({ id, name, kind, src, thumbSrc, variant, loadOriginal, onOpen }: MediaPreviewProps) {
  const [playing, setPlaying] = useState(false);
  const fit = variant === "row" ? "object-contain" : "object-cover";
  const still = thumbSrc ? (
    // eslint-disable-next-line @next/next/no-img-element -- user media is served with auth cookies, not optimizable by next/image
    <img src={thumbSrc} alt="" loading="lazy" className={cn("size-full", kind === "image" ? "object-cover" : fit)} />
  ) : null;
  const placeholder = <Icon name={kind === "image" ? "image" : "film-strip"} size={48} className="text-t5" />;

  if (kind === "image") {
    if (still) return still;
    // eslint-disable-next-line @next/next/no-img-element -- see above
    return loadOriginal ? <img src={src} alt="" loading="lazy" className="size-full object-cover" /> : placeholder;
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
          onTimeUpdate={(event) => resumeStore.track(id, event.currentTarget)}
          onPause={(event) => resumeStore.track(id, event.currentTarget)}
          onLoadedMetadata={(event) => resumeStore.restore(id, event.currentTarget)}
          className="block size-full bg-black object-contain"
        />
        <button
          type="button"
          title="Open viewer"
          aria-label="Open viewer"
          onClick={(event) => {
            event.stopPropagation();
            const video = event.currentTarget.parentElement?.querySelector("video");
            if (video) resumeStore.track(id, video);
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
      {still ?? (loadOriginal ? <video src={src} preload="metadata" muted={variant === "card"} playsInline className={cn("size-full", fit)} /> : placeholder)}
      <button
        type="button"
        title="Play here"
        aria-label={`Play ${name} here`}
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
      <ResumeBar id={id} />
    </>
  );
}

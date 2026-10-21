"use client";

import { useState, type SyntheticEvent } from "react";
import { cn } from "@/shared/lib/cn";
import { useVideoSource } from "./useVideoSource";

/** Playback handlers the viewer attaches to its video (resume position, keyboard target). */
export interface MediaHandlers {
  "data-viewer-media": true;
  onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onPause: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => void;
}

/**
 * An image in the viewer: the cached list thumbnail at once (blurred), replaced by the
 * screen-sized preview as soon as it has loaded. The original is never fetched just to look.
 */
export function StageImage({ name, src, thumbSrc }: { name: string; src: string; thumbSrc: string | null }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative flex size-full items-center justify-center">
      {!loaded && thumbSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- user media is served by the app with auth cookies, not optimizable by next/image
        <img src={thumbSrc} alt="" aria-hidden className="absolute inset-0 size-full object-contain blur-md" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img src={src} alt={name} onLoad={() => setLoaded(true)} className={cn("relative max-h-full max-w-full object-contain", !loaded && "opacity-0")} />
    </div>
  );
}

/**
 * A video in the viewer: the thumbnail as poster while the first bytes arrive, the file
 * played with Range requests, or the server's conversion for containers browsers cannot play.
 */
export function StageVideo({ name, src, thumbSrc, transcodeSrc, handlers }: { name: string; src: string; thumbSrc: string | null; transcodeSrc?: string; handlers: MediaHandlers }) {
  const video = useVideoSource(name, src, transcodeSrc);
  return <video {...handlers} src={video.src} onError={video.onError} poster={thumbSrc ?? undefined} controls autoPlay playsInline className="size-full bg-black object-contain" />;
}

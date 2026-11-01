"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { cn } from "@/shared/lib/cn";
import { playback, playbackProps } from "./playback";
import type { SubtitleSource } from "./subtitle-tracks";
import { useSubtitleTracks } from "./useSubtitleTracks";
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
 * In a slideshow (`fade`) the picture fades in, unless the system asks for reduced motion.
 */
export function StageImage({ name, src, thumbSrc, fade = false }: { name: string; src: string; thumbSrc: string | null; fade?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative flex size-full items-center justify-center">
      {!loaded && thumbSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- user media is served by the app with auth cookies, not optimizable by next/image
        <img src={thumbSrc} alt="" aria-hidden className="absolute inset-0 size-full object-contain blur-md" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={src}
        alt={name}
        onLoad={() => setLoaded(true)}
        className={cn("relative max-h-full max-w-full object-contain", fade && "motion-safe:transition-opacity motion-safe:duration-[400ms]", !loaded && "opacity-0")}
      />
    </div>
  );
}

/** Shows the first subtitle track unless one is showing already. */
function showFirstTrack(video: HTMLVideoElement | null): void {
  const list = video?.textTracks;
  if (!list || list.length === 0 || Array.from(list).some((track) => track.mode === "showing")) return;
  list[0]!.mode = "showing";
}

interface StageVideoProps {
  name: string;
  src: string;
  thumbSrc: string | null;
  transcodeSrc?: string;
  subtitles?: SubtitleSource[];
  handlers: MediaHandlers;
}

/**
 * A video in the viewer: the thumbnail as poster while the first bytes arrive, the file
 * played with Range requests, or the server's conversion for containers browsers cannot play.
 * Subtitle files beside it become `<track>`s; the first one shows until the user turns it off.
 */
export function StageVideo({ name, src, thumbSrc, transcodeSrc, subtitles, handlers }: StageVideoProps) {
  const video = useVideoSource(name, src, transcodeSrc);
  const tracks = useSubtitleTracks(subtitles);
  const element = useRef<HTMLVideoElement | null>(null);
  // Stable, so React does not detach and re-attach it (which would release single playback) on every render.
  const ref = useCallback((node: HTMLVideoElement | null) => {
    element.current = node;
    if (!node) return undefined;
    return () => {
      element.current = null;
      playback.release(node);
    };
  }, []);
  // `default` on a track added after the video started still turns it on; this covers browsers that skip it.
  useEffect(() => showFirstTrack(element.current), [tracks]);
  return (
    <video
      {...handlers}
      {...playbackProps}
      ref={ref}
      src={video.src}
      onError={video.onError}
      poster={thumbSrc ?? undefined}
      controls
      autoPlay
      playsInline
      className="size-full bg-black object-contain"
    >
      {tracks.map((track, index) => (
        <track key={track.url} kind="subtitles" src={track.url} srcLang={track.lang ?? undefined} label={track.label} default={index === 0} />
      ))}
    </video>
  );
}

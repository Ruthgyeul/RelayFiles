"use client";

import { resumeStore } from "./resume";

/**
 * Audio player under a file name in lists. Nothing is fetched until it plays; the position
 * is saved like the viewer's so playback continues where it stopped.
 */
export function InlineAudio({ id, name, src }: { id: string; name: string; src: string }) {
  return (
    <audio
      src={src}
      controls
      preload="none"
      aria-label={`Play ${name}`}
      onClick={(event) => event.stopPropagation()}
      onTimeUpdate={(event) => resumeStore.track(id, event.currentTarget)}
      onPause={(event) => resumeStore.track(id, event.currentTarget)}
      onLoadedMetadata={(event) => resumeStore.restore(id, event.currentTarget)}
      className="block h-10 w-full [color-scheme:dark] sm:w-[min(400px,100%)]"
    />
  );
}

import type { SyntheticEvent } from "react";

/** The part of a media element the single-playback rule needs. */
export type Playable = Pick<HTMLMediaElement, "paused" | "pause">;

let current: Playable | null = null;

/**
 * Only one media element plays at a time across list previews, inline audio and the viewer:
 * starting one pauses the one that was playing before.
 */
export const playback = {
  /** Call from `onPlay`: pauses the previous element when it is another one still playing. */
  claim(media: Playable) {
    if (current && current !== media && !current.paused) current.pause();
    current = media;
  },
  /** Forgets an element that is going away so it is not held after unmount. */
  release(media: Playable) {
    if (current === media) current = null;
  },
};

/** Props for a `<video>` or `<audio>` that takes part in single playback. */
export const playbackProps = {
  onPlay: (event: SyntheticEvent<HTMLMediaElement>) => playback.claim(event.currentTarget),
  ref: (element: HTMLMediaElement | null) => (element ? () => playback.release(element) : undefined),
};

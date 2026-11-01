"use client";

import { useEffect, useRef } from "react";

const SEEK = { short: 5, long: 10 } as const;
const VOLUME_STEP = 0.1;
const PERCENT = 100;

/** A focused control handles Space itself (a button clicks), so the slideshow does not toggle twice. */
const onControl = (target: EventTarget | null) => target instanceof Element && target.closest("button, a, input, textarea, select, [contenteditable]") !== null;

export interface ViewerKeyActions {
  /** Previous (-1) or next (1) file, as the user's own step (it stops a slideshow). */
  step: (delta: number) => void;
  close: () => void;
  /** The full-screen mobile viewer is not a Modal, so it closes itself on Escape. */
  small: boolean;
  notify: (message: string) => void;
  slideshow: { available: boolean; toggle: () => void };
}

/**
 * Viewer keys while it is open. Space/K play or pause the media (or the slideshow on a
 * picture), ←/→ 5 s (or previous/next file), J/L 10 s, ↑/↓ volume, M mute, F fullscreen,
 * N/P next/previous, Esc close.
 */
export function useViewerKeys(open: boolean, actions: ViewerKeyActions) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const { step, close, small, notify, slideshow } = latest.current;
      const media = document.querySelector<HTMLMediaElement>("[data-viewer-media]");
      const key = event.key.toLowerCase();
      if (event.key === "Escape" && small) close();
      else if (media && (key === " " || key === "k")) {
        event.preventDefault();
        if (media.paused) void media.play();
        else media.pause();
      } else if (!media && key === " " && slideshow.available && !onControl(event.target)) {
        event.preventDefault();
        slideshow.toggle();
      } else if (media && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        media.currentTime = Math.max(0, media.currentTime + (event.key === "ArrowRight" ? SEEK.short : -SEEK.short));
      } else if (media && (key === "j" || key === "l")) {
        media.currentTime = Math.max(0, media.currentTime + (key === "l" ? SEEK.long : -SEEK.long));
      } else if (media && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        media.volume = Math.min(1, Math.max(0, media.volume + (event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP)));
        notify(`Volume ${Math.round(media.volume * PERCENT)}%`);
      } else if (media && key === "m") {
        media.muted = !media.muted;
        notify(media.muted ? "Muted" : "Sound on");
      } else if (media && key === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void media.requestFullscreen?.();
      } else if (event.key === "ArrowRight" || key === "n") step(1);
      else if (event.key === "ArrowLeft" || key === "p") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}

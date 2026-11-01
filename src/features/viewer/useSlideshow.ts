"use client";

import { useEffect, useRef, useState } from "react";
import { VIEWER } from "@/config/policy";
import { canSlideshow, firstSlideIndex, nextSlideIndex } from "@/domain/slideshow";

interface SlideshowItem {
  id: string;
  kind: string;
}

/**
 * The viewer's slideshow: while playing, the next picture opens every
 * VIEWER.slideshowIntervalMs; it stops after the last picture and when the user steps or
 * closes the viewer (`stop`). Starting on the last picture starts again from the first.
 */
export function useSlideshow(items: readonly SlideshowItem[], index: number, select: (id: string) => void, notify: (message: string) => void) {
  const [playing, setPlaying] = useState(false);
  const available = canSlideshow(items, index);
  const active = playing && available;
  // The parent rebuilds `items` on every render; the timer only restarts when the picture changes.
  const latest = useRef({ items, select, notify });
  useEffect(() => {
    latest.current = { items, select, notify };
  });
  const currentId = items[index]?.id;

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      const { items: list, select: open, notify: tell } = latest.current;
      const at = list.findIndex((item) => item.id === currentId);
      const next = nextSlideIndex(list, at);
      if (next === null) {
        setPlaying(false);
        tell("Slideshow ended");
      } else open(list[next]!.id);
    }, VIEWER.slideshowIntervalMs);
    return () => clearTimeout(timer);
  }, [active, currentId]);

  return {
    available,
    playing: active,
    toggle: () => {
      if (!available) return;
      if (active) {
        setPlaying(false);
        notify("Slideshow paused");
        return;
      }
      if (nextSlideIndex(items, index) === null) {
        const first = firstSlideIndex(items);
        if (first !== null) select(items[first]!.id);
      }
      setPlaying(true);
      notify("Slideshow started");
    },
    stop: () => setPlaying(false),
  };
}

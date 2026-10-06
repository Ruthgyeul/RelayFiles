"use client";

import { useSyncExternalStore } from "react";

/** Design breakpoints: mobile below 720px, desktop from 1024px. */
const QUERIES = { small: "(max-width: 719.98px)", wide: "(min-width: 1024px)" } as const;

function subscribe(callback: () => void) {
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", callback);
  return () => {
    for (const list of lists) list.removeEventListener("change", callback);
  };
}

/**
 * For logic that differs by width (crumb count, menu as bottom sheet). Visual differences
 * use Tailwind breakpoints instead. The server render assumes a desktop.
 */
export function useViewport(): { small: boolean; wide: boolean } {
  const small = useSyncExternalStore(subscribe, () => window.matchMedia(QUERIES.small).matches, () => false);
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(QUERIES.wide).matches, () => true);
  return { small, wide };
}

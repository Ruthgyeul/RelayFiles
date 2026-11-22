"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const noSubscription = () => () => undefined;
/** Whether the browser has IntersectionObserver (the server answers yes: nothing is in view there). */
const canObserve = () => typeof IntersectionObserver !== "undefined";

/**
 * True once the element has come within `margin` px of the viewport (and from then on), so
 * something costly (a video's first frame) loads only for rows the user scrolls to. It starts
 * false on the server and while hydrating (no mismatch); without IntersectionObserver it is
 * true from then on.
 */
export function useInView(ref: RefObject<Element | null>, margin: number): boolean {
  const [seen, setSeen] = useState(false);
  const observable = useSyncExternalStore(noSubscription, canObserve, () => true);
  useEffect(() => {
    const node = ref.current;
    if (seen || !node || !observable) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: `${margin}px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, margin, seen, observable]);
  return seen || !observable;
}

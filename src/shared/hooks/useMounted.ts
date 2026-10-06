"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True only after hydration on the client; false during SSR. Use for portals and browser-only APIs. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

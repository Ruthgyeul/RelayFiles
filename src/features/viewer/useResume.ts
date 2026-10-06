"use client";

import { useSyncExternalStore } from "react";
import { resumeStore, type ResumePoint } from "./resume";

/** Saved playback position of a file; updates while it plays. Nothing on the server render. */
export function useResume(id: string): ResumePoint | undefined {
  return useSyncExternalStore(
    resumeStore.subscribe,
    () => resumeStore.get(id),
    () => undefined,
  );
}

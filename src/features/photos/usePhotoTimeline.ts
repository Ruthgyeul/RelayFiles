"use client";

import { useState } from "react";
import type { TimelineItem, TimelinePage } from "@/contracts/timeline";
import { photosApi } from "./photos-api";

interface TimelineState {
  status: "ready" | "loading" | "error";
  items: TimelineItem[];
  nextCursor: string | null;
}

/** The timeline from the server-rendered first page, one more page per `loadMore`. */
export function usePhotoTimeline(initial: TimelinePage) {
  const [state, setState] = useState<TimelineState>({ status: "ready", items: initial.items, nextCursor: initial.nextCursor });

  const loadMore = () => {
    const cursor = state.nextCursor;
    if (!cursor || state.status === "loading") return;
    setState({ ...state, status: "loading" });
    photosApi
      .page(cursor)
      .then((page) =>
        // A page that answers a cursor no longer at the end (loaded twice) is dropped.
        setState((previous) => (previous.nextCursor !== cursor ? previous : { status: "ready", items: [...previous.items, ...page.items], nextCursor: page.nextCursor })),
      )
      .catch(() => setState((previous) => ({ ...previous, status: "error" })));
  };

  return { items: state.items, status: state.status, hasMore: state.nextCursor !== null, loadMore };
}

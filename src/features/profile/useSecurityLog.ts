"use client";

import { useEffect, useState } from "react";
import type { SecurityLogEntry } from "@/contracts/profile";
import { profileApi } from "./api";

interface LogState {
  status: "loading" | "ready" | "error";
  events: SecurityLogEntry[];
  nextCursor: string | null;
  /** Which load the list belongs to: a page asked for before a reload is dropped, not appended. */
  load: string;
}

/**
 * The account's security log for the profile: the newest page, then one more page per
 * `loadMore`. `changes` is bumped after an action on the page (a device signed out, a token
 * made) to reload from the newest entry.
 */
export function useSecurityLog(changes: number) {
  const [attempt, setAttempt] = useState(0);
  const load = `${changes}:${attempt}`;
  const [state, setState] = useState<LogState>({ status: "loading", events: [], nextCursor: null, load });

  useEffect(() => {
    let cancelled = false;
    profileApi
      .securityLog()
      .then((page) => !cancelled && setState({ status: "ready", events: page.events, nextCursor: page.nextCursor, load }))
      .catch(() => !cancelled && setState({ status: "error", events: [], nextCursor: null, load }));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = () => {
    const cursor = state.nextCursor;
    if (!cursor || state.status === "loading") return;
    const from = state.load;
    setState({ ...state, status: "loading" });
    profileApi
      .securityLog(cursor)
      .then((page) => setState((previous) => (previous.load !== from ? previous : { ...previous, status: "ready", events: [...previous.events, ...page.events], nextCursor: page.nextCursor })))
      .catch(() => setState((previous) => (previous.load !== from ? previous : { ...previous, status: "error" })));
  };

  return {
    events: state.events,
    status: state.status,
    hasMore: state.nextCursor !== null,
    loadMore,
    retry: () => {
      if (state.events.length > 0) return loadMore();
      setState({ status: "loading", events: [], nextCursor: null, load });
      setAttempt((count) => count + 1);
    },
  };
}

"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { errorMessage } from "@/shared/lib/api-client";

export interface ApiQueryOptions {
  /** Wait this long after the key last changed before fetching (typing in a search box). */
  debounceMs?: number;
  /** Keep showing the previous key's data while the new key loads (a search narrowing as it is typed). */
  keepPrevious?: boolean;
}

/**
 * One read from the API. While a reload (or, with `keepPrevious`, a new key) is loading,
 * `data` stays at the last result so lists don't blink empty; `status` says whether it is current.
 */
export type ApiQuery<T> = (
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: T | null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: T | null; error: string }
) & { reload: () => void };

type Settled<T> = { key: string; round: number } & ({ ok: true; data: T } | { ok: false; error: string });

/**
 * Fetches `fetcher(key)` whenever `key` changes (null: nothing to fetch) or `reload()` is called,
 * aborting the request it replaces. `key` must capture everything the fetcher reads; the
 * fetcher itself may be an inline closure. A failure gives the user-safe message
 * ({@link errorMessage}) instead of looking like an empty result.
 */
export function useApiQuery<T>(key: string | null, fetcher: (key: string, signal: AbortSignal) => Promise<T>, { debounceMs = 0, keepPrevious = false }: ApiQueryOptions = {}): ApiQuery<T> {
  const [round, setRound] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [last, setLast] = useState<{ key: string; data: T } | null>(null);
  const run = useEffectEvent((current: string, signal: AbortSignal) => fetcher(current, signal));

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const start = () => {
      run(key, controller.signal).then(
        (data) => {
          if (controller.signal.aborted) return;
          setSettled({ key, round, ok: true, data });
          setLast({ key, data });
        },
        (caught: unknown) => !controller.signal.aborted && setSettled({ key, round, ok: false, error: errorMessage(caught) }),
      );
    };
    const timer = debounceMs > 0 ? setTimeout(start, debounceMs) : null;
    if (!timer) start();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, round, debounceMs]);

  const reload = useCallback(() => setRound((value) => value + 1), []);

  if (key === null) return { status: "idle", data: null, error: null, reload };
  const previous = last && (keepPrevious || last.key === key) ? last.data : null;
  if (settled?.key !== key || settled.round !== round) return { status: "loading", data: previous, error: null, reload };
  return settled.ok ? { status: "ready", data: settled.data, error: null, reload } : { status: "error", data: previous, error: settled.error, reload };
}

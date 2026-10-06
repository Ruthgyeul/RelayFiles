"use client";

import { useEffect, useState } from "react";
import { SEARCH } from "@/config/policy";
import type { TaggedItem } from "@/contracts/nodes";
import { apiFetch } from "@/shared/lib/api-client";

/** Results for the query typed in the global search, fetched after a short pause. */
export function useGlobalSearch(query: string, enabled: boolean): { results: TaggedItem[]; loading: boolean } {
  const [found, setFound] = useState<{ query: string; items: TaggedItem[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<TaggedItem[]>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((items) => !cancelled && setFound({ query, items }))
        .catch(() => !cancelled && setFound({ query, items: [] }));
    }, SEARCH.debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  const current = found?.query === query;
  return { results: current ? found.items : [], loading: !current };
}

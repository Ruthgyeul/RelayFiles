"use client";

import { SEARCH } from "@/config/policy";
import type { TaggedItem } from "@/contracts/nodes";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { apiFetch } from "@/shared/lib/api-client";

/** Results for the query typed in the global search, fetched after a short pause; `error` when it failed. */
export function useGlobalSearch(query: string, enabled: boolean): { results: TaggedItem[]; loading: boolean; error: string | null } {
  const found = useApiQuery(enabled ? query : null, (q, signal) => apiFetch<TaggedItem[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal }), { debounceMs: SEARCH.debounceMs });
  return { results: found.status === "ready" ? found.data : [], loading: found.status === "loading", error: found.error };
}

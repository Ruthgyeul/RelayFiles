"use client";

import type { SavedSearchDto } from "@/contracts/saved-searches";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { apiFetch, errorMessage } from "@/shared/lib/api-client";

const BASE = "/api/saved-searches";

/** The account's saved global searches, with saving and deleting (the list reloads after each). */
export function useSavedSearches(enabled: boolean, notify: (message: string) => void) {
  const list = useApiQuery(enabled ? "saved-searches" : null, (_, signal) => apiFetch<SavedSearchDto[]>(BASE, { signal }));
  const change = async (request: () => Promise<unknown>, message: string) => {
    try {
      await request();
      list.reload();
      notify(message);
    } catch (caught) {
      notify(errorMessage(caught));
    }
  };
  return {
    saved: list.data ?? [],
    save: (query: string) => change(() => apiFetch<SavedSearchDto>(BASE, { method: "POST", json: { query } }), "Search saved"),
    remove: (id: string) => change(() => apiFetch<{ deleted: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }), "Saved search deleted"),
  };
}

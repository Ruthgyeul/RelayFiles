"use client";

import { useMemo, useState } from "react";
import { SEARCH } from "@/config/policy";
import type { TaggedItem } from "@/contracts/nodes";
import { parseTags } from "@/domain/tags";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { filesApi } from "@/shared/lib/files-api";

/**
 * Tag mode of the folder search: a query starting with # runs `search` (by default every folder
 * of the account). A new `reloadOn` value (the page data after a change) runs it again, keeping
 * the shown results until the new ones arrive. `error` is set when the search failed.
 */
export function useTagSearch(
  query: string,
  search: (tags: string[]) => Promise<TaggedItem[]> = filesApi.searchTags,
  reloadOn?: unknown,
): { tagMode: boolean; wanted: string[]; results: TaggedItem[]; error: string | null } {
  const q = query.trim().toLowerCase();
  const tagMode = q.startsWith("#");
  const wanted = useMemo(() => (tagMode ? parseTags(q) : []), [tagMode, q]);
  const key = wanted.join(",");
  const found = useApiQuery(key || null, (tags) => search(tags.split(",")), { debounceMs: SEARCH.debounceMs });
  const [seen, setSeen] = useState(reloadOn);
  if (seen !== reloadOn) {
    setSeen(reloadOn);
    found.reload();
  }

  return { tagMode, wanted, results: found.status === "error" ? [] : (found.data ?? []), error: found.error };
}

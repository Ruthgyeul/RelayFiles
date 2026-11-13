"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaggedItem } from "@/contracts/nodes";
import { parseTags } from "@/domain/tags";
import { filesApi } from "@/shared/lib/files-api";

/** Delay before a tag search runs while typing. */
const DEBOUNCE_MS = 200;

/**
 * Tag mode of the folder search: a query starting with # runs `search` (by default every folder
 * of the account). `search` must be a stable (module-level) function; a new `reloadOn` value
 * (the page data after a change) runs it again, keeping the shown results until the new ones arrive.
 */
export function useTagSearch(
  query: string,
  search: (tags: string[]) => Promise<TaggedItem[]> = filesApi.searchTags,
  reloadOn?: unknown,
): { tagMode: boolean; wanted: string[]; results: TaggedItem[] } {
  const q = query.trim().toLowerCase();
  const tagMode = q.startsWith("#");
  const wanted = useMemo(() => (tagMode ? parseTags(q) : []), [tagMode, q]);
  const key = wanted.join(",");
  const [found, setFound] = useState<{ key: string; items: TaggedItem[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      search(key.split(","))
        .then((items) => !cancelled && setFound({ key, items }))
        .catch(() => !cancelled && setFound({ key, items: [] }));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, search, reloadOn]);

  return { tagMode, wanted, results: found?.key === key ? found.items : [] };
}

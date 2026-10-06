"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaggedItem } from "@/contracts/nodes";
import { parseTags } from "@/domain/tags";
import { filesApi } from "./api";

/** Delay before a tag search runs while typing. */
const DEBOUNCE_MS = 200;

/** Tag mode of the folder search: a query starting with # searches every folder of the account. */
export function useTagSearch(query: string): { tagMode: boolean; wanted: string[]; results: TaggedItem[] } {
  const q = query.trim().toLowerCase();
  const tagMode = q.startsWith("#");
  const wanted = useMemo(() => (tagMode ? parseTags(q) : []), [tagMode, q]);
  const key = wanted.join(",");
  const [found, setFound] = useState<{ key: string; items: TaggedItem[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      filesApi
        .searchTags(key.split(","))
        .then((items) => !cancelled && setFound({ key, items }))
        .catch(() => !cancelled && setFound({ key, items: [] }));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return { tagMode, wanted, results: found?.key === key ? found.items : [] };
}

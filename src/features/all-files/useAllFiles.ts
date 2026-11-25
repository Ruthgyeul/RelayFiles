"use client";

import { useState } from "react";
import { SEARCH } from "@/config/policy";
import type { AllFilesPage } from "@/contracts/all-files";
import type { TaggedItem } from "@/contracts/nodes";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { allFilesApi, type AllFilesRequest } from "./api";

/** The query the server renders the page with. */
export const DEFAULT_REQUEST: AllFilesRequest = { sort: "date", kind: "all", q: "" };
const keyOf = (request: AllFilesRequest) => JSON.stringify([request.sort, request.kind, request.q.trim()]);
const DEFAULT_KEY = keyOf(DEFAULT_REQUEST);

interface More {
  /** The first page these pages continue (a new first page drops them). */
  base: AllFilesPage;
  items: TaggedItem[];
  nextCursor: string | null;
  status: "ready" | "loading" | "error";
}

/**
 * "All Files" for a sort, type and search: the first page (the server's for the default query,
 * fetched again whenever the query changes or the page is refreshed), then one more page per
 * `loadMore`. Filtering happens on the server, so every page is right however few are loaded.
 */
export function useAllFiles(initial: AllFilesPage, request: AllFilesRequest) {
  // router.refresh() (after a change, or a change made elsewhere) renders a new first page:
  // queries other than the default one are asked again then.
  const [seen, setSeen] = useState(initial);
  const [revision, setRevision] = useState(0);
  if (seen !== initial) {
    setSeen(initial);
    setRevision((value) => value + 1);
  }
  const key = keyOf(request);
  const fetched = useApiQuery(key === DEFAULT_KEY ? null : `${key}#${revision}`, (_, signal) => allFilesApi.page(request, null, signal), {
    debounceMs: request.q.trim() ? SEARCH.debounceMs : 0,
    keepPrevious: true,
  });
  const first = key === DEFAULT_KEY ? initial : fetched.data;
  const [more, setMore] = useState<More | null>(null);
  const extra = more && first && more.base === first ? more : null;
  const nextCursor = extra ? extra.nextCursor : (first?.nextCursor ?? null);

  const loadMore = () => {
    if (!first || !nextCursor || extra?.status === "loading") return;
    const base = first;
    setMore({ base, items: extra?.items ?? [], nextCursor, status: "loading" });
    allFilesApi
      .page(request, nextCursor)
      .then((page) => setMore((current) => (current?.base === base ? { base, items: [...current.items, ...page.items], nextCursor: page.nextCursor, status: "ready" } : current)))
      .catch(() => setMore((current) => (current?.base === base ? { ...current, status: "error" } : current)));
  };

  return {
    items: first ? [...first.items, ...(extra?.items ?? [])] : [],
    counts: first?.counts ?? null,
    loading: key !== DEFAULT_KEY && fetched.status === "loading",
    error: key !== DEFAULT_KEY ? fetched.error : null,
    hasMore: nextCursor !== null,
    moreStatus: extra?.status ?? "ready",
    loadMore,
  };
}

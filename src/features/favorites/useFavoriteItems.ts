"use client";

import { useMemo } from "react";
import type { FavoritesView } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import { sortFavorites, visibleFavoriteFolders, type FavoriteSortKey } from "@/domain/favorites";
import { hasAllTags } from "@/domain/tags";
import { FILTER_KEYS, matchesFilter, type FilterKey } from "@/domain/tree";
import { toSortable } from "@/features/files/settings";
import { useTagSearch } from "@/features/files/useTagSearch";
import { favoritesApi } from "@/shared/lib/favorites-api";

/**
 * What the Favorites page lists: this level's favorites and organizing folders filtered by type
 * and name, or, for a query starting with #, favorites with every tag from all organizing folders.
 */
export function useFavoriteItems(view: FavoritesView, filter: FilterKey, query: string, sort: FavoriteSortKey) {
  const q = query.trim().toLowerCase();
  const { tagMode, wanted, results } = useTagSearch(query, favoritesApi.searchTags, view);
  const counts = useMemo(() => {
    const count = (key: FilterKey) => view.items.filter((item) => matchesFilter(item, key)).length + (key === "all" || key === "folder" ? view.folders.length : 0);
    return Object.fromEntries(FILTER_KEYS.map((key) => [key, count(key)])) as Record<FilterKey, number>;
  }, [view.items, view.folders]);
  const items: TaggedItem[] = useMemo(() => {
    const source = tagMode
      ? results.filter((item) => hasAllTags(item.tags, wanted) && matchesFilter(item, filter))
      : view.items.filter((item) => matchesFilter(item, filter) && (!q || item.name.toLowerCase().includes(q)));
    return sortFavorites(source.map(toSortable), sort).map((entry) => entry.item);
  }, [tagMode, results, wanted, filter, view.items, q, sort]);
  const folders = useMemo(() => visibleFavoriteFolders(view.folders, { query: q, filter, tagMode, sort }), [view.folders, q, filter, tagMode, sort]);
  return { items, folders, counts, tagMode, wanted, q };
}

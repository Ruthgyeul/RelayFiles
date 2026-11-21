"use client";

import { useMemo } from "react";
import type { NodeItem, TaggedItem } from "@/contracts/nodes";
import { hasAllTags } from "@/domain/tags";
import { FILTER_KEYS, matchesFilter, sortNodes, type FilterKey, type SortKey } from "@/domain/tree";
import { toSortable } from "./settings";
import { useTagSearch } from "./useTagSearch";

/** A folder child, or a tag search hit from another folder (with where it is). */
export type ListedItem = NodeItem & Partial<Pick<TaggedItem, "parentPath" | "parentId" | "parentVisibility">>;

/**
 * Items shown in the list: the folder's children filtered by type and name, or tag search
 * results from the whole account when the query starts with #. Sorted with folders first.
 */
export function useFolderItems(children: NodeItem[], filter: FilterKey, query: string, sort: SortKey) {
  const q = query.trim().toLowerCase();
  // A new `children` (the page data after a change) runs the tag search again.
  const { tagMode, wanted, results, error: searchError } = useTagSearch(query, undefined, children);
  const counts = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((key) => [key, children.filter((child) => matchesFilter(child, key)).length])) as Record<FilterKey, number>,
    [children],
  );
  const items: ListedItem[] = useMemo(() => {
    const source: ListedItem[] = tagMode
      ? results.filter((item) => hasAllTags(item.tags, wanted) && matchesFilter(item, filter))
      : children.filter((child) => matchesFilter(child, filter) && (!q || child.name.toLowerCase().includes(q)));
    return sortNodes(source.map(toSortable), sort).map((entry) => entry.item);
  }, [tagMode, results, wanted, filter, children, q, sort]);
  return { items, counts, tagMode, wanted, q, searchError };
}

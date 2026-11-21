"use client";

import { itemCount, type FilterKey } from "@/domain/tree";
import { FilterBar } from "./FilterBar";
import { SearchBox, TagModeBar } from "./SearchBox";
import type { useFileSearch } from "./useFileSearch";

interface ListChromeProps {
  search: ReturnType<typeof useFileSearch>;
  /** Items per type filter; the filter bar is shown only when the list has items. */
  counts: Record<FilterKey, number>;
  showFilters: boolean;
  /** A type filter was picked (the page clears its selection). */
  onFilter: (key: FilterKey) => void;
  tagMode: boolean;
  wanted: string[];
  /** Items the tag search found. */
  matched: number;
  /** The search box's label and placeholder, and where a tag search looks. */
  label?: string;
  placeholder?: string;
  scope?: string;
}

/** What sits between a list page's toolbar and its items: type filters, the search box and the tag search bar. */
export function ListChrome({ search, counts, showFilters, onFilter, tagMode, wanted, matched, label, placeholder, scope }: ListChromeProps) {
  return (
    <>
      {showFilters && <FilterBar counts={counts} value={search.filter} onChange={onFilter} />}
      {search.searchOpen && <SearchBox value={search.query} onChange={search.setQuery} label={label} placeholder={placeholder} />}
      {tagMode && <TagModeBar label={wanted.length ? wanted.map((tag) => `#${tag}`).join(" + ") : "Type a tag after #"} count={itemCount(matched)} scope={scope} onClear={search.clear} />}
    </>
  );
}

"use client";

import { useState } from "react";
import { withTagQuery } from "@/domain/tags";
import type { FilterKey } from "@/domain/tree";

/** The File Manager's type filter and in-folder search (text or "#tag" query). */
export function useFileSearch() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  return {
    filter,
    setFilter,
    searchOpen,
    openSearch: () => setSearchOpen(true),
    /** The toolbar's search button: opens or closes the box, starting empty. */
    toggleSearch: () => {
      setSearchOpen((value) => !value);
      setQuery("");
    },
    query,
    setQuery,
    /** A tag clicked on an item: searches for it along with the tags already asked for. */
    searchTag: (tag: string) => {
      setSearchOpen(true);
      setQuery((current) => withTagQuery(current, tag));
    },
    /** Leaves tag mode. */
    clear: () => {
      setQuery("");
      setSearchOpen(false);
    },
  };
}

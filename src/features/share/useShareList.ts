"use client";

import { useMemo, useState } from "react";
import type { ShareItem } from "@/contracts/share";
import { SORT_KEYS, sortNodes, type SortKey } from "@/domain/tree";
import { useViewPrefs, type ViewPrefs } from "@/features/files/usePrefs";

const PREFS_KEY = "relay.shareView";
const DEFAULTS: ViewPrefs<SortKey> = { view: "list", sort: "name" };

/** What a visitor sees of a shared folder: searched by name, in the chosen order and view (remembered per device). */
export function useShareList(items: readonly ShareItem[]) {
  const [prefs, setPrefs] = useViewPrefs(PREFS_KEY, SORT_KEYS, DEFAULTS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
    const sortable = matching.map((item) => ({ item, type: item.type, kind: item.kind, name: item.name, size: Number(item.size), createdAt: Date.parse(item.createdAt) }));
    return sortNodes(sortable, prefs.sort).map((entry) => entry.item);
  }, [items, query, prefs.sort]);
  return {
    visible,
    view: prefs.view,
    sort: prefs.sort,
    setSort: (sort: SortKey) => setPrefs({ sort }),
    toggleView: () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" }),
    searchOpen,
    query,
    setQuery,
    /** Opens the search box, or closes it and shows everything again. */
    toggleSearch: () => {
      setSearchOpen((open) => !open);
      setQuery("");
    },
  };
}

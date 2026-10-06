"use client";

import { useEffect, useState } from "react";
import { SORT_KEYS, type SortKey } from "@/domain/tree";
import { readLocalSetting, writeLocalSetting } from "@/shared/lib/local-setting";

export type ViewMode = "list" | "grid";

interface Prefs {
  view: ViewMode;
  sort: SortKey;
}

const KEY = "relay.filesView";
const DEFAULT_PREFS: Prefs = { view: "list", sort: "name" };

const isPrefs = (value: unknown): value is Prefs =>
  typeof value === "object" &&
  value !== null &&
  ((value as Prefs).view === "list" || (value as Prefs).view === "grid") &&
  (SORT_KEYS as readonly string[]).includes((value as Prefs).sort);

/** View mode and sort order, remembered per device (localStorage, read after hydration). */
export function usePrefs(): [Prefs, (next: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    const saved = readLocalSetting(KEY, isPrefs);
    if (saved) queueMicrotask(() => setPrefs(saved));
  }, []);
  const update = (next: Partial<Prefs>) =>
    setPrefs((current) => {
      const merged = { ...current, ...next };
      writeLocalSetting(KEY, merged);
      return merged;
    });
  return [prefs, update];
}

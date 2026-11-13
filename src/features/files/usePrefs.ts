"use client";

import { useEffect, useState } from "react";
import { SORT_KEYS, type SortKey } from "@/domain/tree";
import { readLocalSetting, writeLocalSetting } from "@/shared/lib/local-setting";

export type ViewMode = "list" | "grid";

export interface ViewPrefs<S extends string> {
  view: ViewMode;
  sort: S;
}

const isViewPrefs =
  <S extends string>(sortKeys: readonly S[]) =>
  (value: unknown): value is ViewPrefs<S> =>
    typeof value === "object" &&
    value !== null &&
    ((value as ViewPrefs<S>).view === "list" || (value as ViewPrefs<S>).view === "grid") &&
    (sortKeys as readonly string[]).includes((value as ViewPrefs<S>).sort);

/** View mode and sort order of one list, remembered per device under `key` (localStorage, read after hydration). `key` and `sortKeys` are module constants. */
export function useViewPrefs<S extends string>(key: string, sortKeys: readonly S[], defaults: ViewPrefs<S>): [ViewPrefs<S>, (next: Partial<ViewPrefs<S>>) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs<S>>(defaults);
  useEffect(() => {
    const saved = readLocalSetting(key, isViewPrefs(sortKeys));
    if (saved) queueMicrotask(() => setPrefs(saved));
  }, [key, sortKeys]);
  const update = (next: Partial<ViewPrefs<S>>) =>
    setPrefs((current) => {
      const merged = { ...current, ...next };
      writeLocalSetting(key, merged);
      return merged;
    });
  return [prefs, update];
}

const FILES_KEY = "relay.filesView";
const FILES_DEFAULTS: ViewPrefs<SortKey> = { view: "list", sort: "name" };

/** The File Manager's view mode and sort order. */
export function usePrefs(): [ViewPrefs<SortKey>, (next: Partial<ViewPrefs<SortKey>>) => void] {
  return useViewPrefs(FILES_KEY, SORT_KEYS, FILES_DEFAULTS);
}

"use client";

import { createContext, useContext, useEffect } from "react";

/** Lets a page replace the header title (e.g. the current folder name in the File Manager). */
export const PageTitleContext = createContext<(title: string | null) => void>(() => undefined);

export function usePageTitle(title: string | null): void {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}

"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/features/shortcuts/shortcuts";

interface ShortcutHandlers {
  selectAll: () => void;
  search: () => void;
  toggleView: () => void;
  parent: () => void;
}

/**
 * File Manager keys from the design: / search, G grid or list, Ctrl/Cmd+A select all,
 * Backspace parent folder. Ignored while typing or while a dialog is open.
 */
export function useFileShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const { selectAll, search, toggleView, parent } = latest.current;
      if ((event.metaKey || event.ctrlKey) && key === "a") {
        event.preventDefault();
        selectAll();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "/") {
        event.preventDefault();
        search();
      } else if (key === "g") toggleView();
      else if (key === "backspace") parent();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

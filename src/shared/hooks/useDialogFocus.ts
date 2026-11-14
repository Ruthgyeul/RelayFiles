"use client";

import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Open dialogs (modals, the navigation drawer, bottom sheets), newest last. Escape and Tab belong
 * to the newest one only: a confirm dialog over another dialog must not close both.
 */
const openDialogs: string[] = [];
const isTopDialog = (id: string) => openDialogs[openDialogs.length - 1] === id;

/**
 * The element that most recently lost focus to another one. A dialog field with autoFocus takes
 * focus during React's commit, before any effect runs, so the dialog reads its opener from here.
 */
let lastFocusLeft: EventTarget | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      lastFocusLeft = event.relatedTarget;
    },
    true,
  );
}

export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogFocusOptions {
  open: boolean;
  onClose: () => void;
  /** When false, Escape does not close it (e.g. "Save your account token"). */
  dismissible?: boolean;
  /** What gets focus on open when nothing inside has it yet: the first control (default), or the panel itself. */
  initialFocus?: "first" | "panel";
}

/**
 * Focus handling every dialog shares: focus moves in on open (an autoFocus field keeps it), Tab
 * stays inside, Escape closes only the newest dialog, and focus goes back to the element that
 * opened it. `onClose` may be a new function on every render without moving focus again.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, { open, onClose, dismissible = true, initialFocus = "first" }: DialogFocusOptions): string {
  const id = useId();
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    // An autoFocus field inside took focus before this effect ran: focus goes back to the element
    // it took focus from. Otherwise to whatever has focus now.
    const focusedInside = node?.contains(document.activeElement) ?? false;
    const previous = (focusedInside ? lastFocusLeft : document.activeElement) as HTMLElement | null;
    if (!focusedInside) (initialFocus === "first" ? (node?.querySelector<HTMLElement>(FOCUSABLE) ?? node) : node)?.focus();
    openDialogs.push(id);

    const onKey = (event: KeyboardEvent) => {
      if (!isTopDialog(id)) return;
      if (event.key === "Escape" && dismissible) {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      // Focus on the panel itself (initialFocus "panel") counts as before the first control.
      if (event.shiftKey && (document.activeElement === head || document.activeElement === node)) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openDialogs.splice(openDialogs.lastIndexOf(id), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, dismissible, initialFocus, id, panel]);

  return id;
}

"use client";

import { useEffect } from "react";

/**
 * Asks the browser to confirm leaving or reloading the page while `active` (unfinished work
 * would be lost). Registered only while needed: a beforeunload listener also keeps the page
 * out of the back/forward cache.
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

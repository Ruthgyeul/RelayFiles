"use client";

import { PREFETCH_HEADER } from "@/contracts/api";

const requested = new Set<string>();

/**
 * Loads an image into the browser cache ahead of time (the viewer's next and previous
 * pictures), so stepping through a gallery shows them at once. Each URL once per page.
 */
export function prefetchImage(url: string): void {
  if (requested.has(url)) return;
  requested.add(url);
  fetch(url, { headers: { [PREFETCH_HEADER]: "1" }, priority: "low" })
    .then((response) => response.blob())
    .catch(() => requested.delete(url));
}

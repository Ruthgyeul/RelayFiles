"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LIVE } from "@/config/policy";

/**
 * Keeps the open page in step with changes made elsewhere (another device, WebDAV, the CLI, the
 * worker finishing a thumbnail): GET /api/events says the account changed, and the page reloads
 * what it shows (router.refresh) once things go quiet. A hidden tab waits until it is shown. A
 * stream the server refused (signed out, too many tabs) is tried again after a while; dropped
 * connections are reconnected by EventSource itself.
 */
export function useLiveRefresh(accountId: string | null): void {
  const router = useRouter();
  useEffect(() => {
    if (!accountId || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let missed = false;

    const refresh = () => {
      if (document.hidden) {
        missed = true;
        return;
      }
      missed = false;
      router.refresh();
    };
    const onChange = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, LIVE.clientDebounceMs);
    };
    const onVisible = () => {
      if (!document.hidden && missed) refresh();
    };
    const open = () => {
      source = new EventSource("/api/events");
      source.onmessage = onChange;
      source.onerror = () => {
        // CLOSED: the server answered with an error, so EventSource gives up; try again later.
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        retry = setTimeout(open, LIVE.clientRetryMs);
      };
    };
    open();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(debounce);
      clearTimeout(retry);
      source?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accountId, router]);
}

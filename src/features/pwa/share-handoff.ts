import { SHARE_TARGET } from "@/config/policy";

/**
 * Asks the service worker (public/sw.js) for the files it took from a share sheet post. They are
 * handed out once; null when the worker no longer has them (it restarted, they were already
 * taken, or it does not answer within SHARE_TARGET.claimTimeoutMs).
 */
export async function claimSharedFiles(id: string): Promise<File[] | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), SHARE_TARGET.claimTimeoutMs))]);
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), SHARE_TARGET.claimTimeoutMs);
    channel.port1.onmessage = (event: MessageEvent<{ files: unknown }>) => {
      clearTimeout(timer);
      const files = event.data?.files;
      resolve(Array.isArray(files) ? files.filter((file): file is File => file instanceof File) : null);
    };
    worker.postMessage({ type: "share-files", id }, [channel.port2]);
  });
}

/**
 * Registers the service worker that receives shared files. Only in a secure context (https or
 * localhost): browsers have no service workers on plain-http LAN addresses, where sharing to the
 * app is not offered. `updateViaCache: "none"` picks up a new worker on the next visit.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
}

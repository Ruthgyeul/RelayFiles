"use client";

import { useEffect, useRef } from "react";
import type { Transfer } from "./transfers-context";

/**
 * Pauses every running transfer while the browser is offline and continues the ones it
 * paused once the connection is back; transfers the user paused stay paused.
 */
export function useOfflinePause(transfers: Transfer[], pause: (id: string, auto: boolean) => void, resume: (id: string) => void): void {
  const latest = useRef(transfers);
  useEffect(() => {
    latest.current = transfers;
  });
  useEffect(() => {
    // Uploads only: a download into a folder fails its current file instead (it cannot resume).
    const onOffline = () => latest.current.filter((transfer) => transfer.status === "active" && transfer.direction === "up").forEach((transfer) => pause(transfer.id, true));
    const onOnline = () => latest.current.filter((transfer) => transfer.status === "paused" && transfer.auto).forEach((transfer) => resume(transfer.id));
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [pause, resume]);
}

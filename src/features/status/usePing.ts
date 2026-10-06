"use client";

import { useCallback, useEffect, useState } from "react";
import { STATUS } from "@/config/policy";
import type { Ping } from "@/domain/status";
import { useMounted } from "@/shared/hooks/useMounted";
import { useOnline } from "@/shared/hooks/useOnline";

/** Network Information API (Chromium only), read when present. */
interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
}

export interface ConnectionInfo {
  /** "4G · ~10 Mbps", or null when the browser doesn't report it. */
  type: string | null;
}

function connectionType(): string | null {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection?.effectiveType) return null;
  return connection.effectiveType.toUpperCase() + (connection.downlink ? ` · ~${connection.downlink} Mbps` : "");
}

/**
 * Checks the server from this browser every 2.5 s while mounted (design `ping`): a HEAD
 * request to the health endpoint, which does no backend work, timed end to end.
 */
export function usePing() {
  const [pings, setPings] = useState<Ping[]>([]);
  const online = useOnline();
  const mounted = useMounted();

  const check = useCallback(async () => {
    const started = performance.now();
    let ok = navigator.onLine;
    if (ok) {
      try {
        ok = (await fetch("/api/health", { method: "HEAD", cache: "no-store" })).ok;
      } catch {
        ok = false;
      }
    }
    const ping = { ms: Math.round(performance.now() - started), ok, at: Date.now() };
    setPings((list) => [...list.slice(-(STATUS.pingHistory - 1)), ping]);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void check(), 0);
    const timer = setInterval(() => void check(), STATUS.pingIntervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [check]);

  // Read on every render (cheap); the browser updates it as the network changes.
  return { pings, online, connection: { type: mounted ? connectionType() : null } satisfies ConnectionInfo, check };
}

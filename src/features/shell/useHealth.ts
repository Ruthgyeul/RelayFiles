"use client";

import { useEffect, useState } from "react";
import type { Health } from "@/contracts/health";
import { levelOfHealth, type StatusLevel } from "@/domain/status";
import { apiFetch } from "@/shared/lib/api-client";

/** How often the footer re-checks server health. */
const HEALTH_POLL_MS = 60_000;

/** Overall server status for the footer; null until the first check finishes. */
export function useHealth(): StatusLevel | null {
  const [level, setLevel] = useState<StatusLevel | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      apiFetch<Health>("/api/health", { cache: "no-store" })
        .then((health) => !cancelled && setLevel(levelOfHealth(health.status)))
        .catch(() => !cancelled && setLevel("down"));
    void check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return level;
}

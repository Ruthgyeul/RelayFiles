"use client";

import { useEffect, useState } from "react";
import type { AuditEntry } from "@/contracts/admin";
import type { AuditGroup } from "@/domain/audit";
import { adminApi } from "./api";

export interface AuditFilter {
  group?: AuditGroup;
  account?: string;
  /** Bumped after an admin action, to reload from the newest entry. */
  changes: number;
}

interface AuditState {
  key: string;
  status: "loading" | "ready" | "error";
  events: AuditEntry[];
  nextCursor: string | null;
}

const keyOf = (filter: AuditFilter) => `${filter.group ?? ""}|${filter.account ?? ""}|${filter.changes}`;

/**
 * The audit log for the admin screen: the first page for the current filter, then one more page
 * per `loadMore`. Changing the filter starts again from the newest entry.
 */
export function useAuditLog(filter: AuditFilter) {
  const key = keyOf(filter);
  const [state, setState] = useState<AuditState>({ key, status: "loading", events: [], nextCursor: null });
  const [attempt, setAttempt] = useState(0);
  const { group, account } = filter;

  useEffect(() => {
    let cancelled = false;
    adminApi
      .audit({ group, account })
      .then((page) => !cancelled && setState({ key, status: "ready", events: page.events, nextCursor: page.nextCursor }))
      .catch(() => !cancelled && setState({ key, status: "error", events: [], nextCursor: null }));
    return () => {
      cancelled = true;
    };
  }, [key, group, account, attempt]);

  const current: AuditState = state.key === key ? state : { key, status: "loading", events: [], nextCursor: null };

  const loadMore = () => {
    const cursor = current.nextCursor;
    if (!cursor || current.status === "loading") return;
    setState({ ...current, status: "loading" });
    adminApi
      .audit({ group, account, cursor })
      .then((page) => setState((previous) => (previous.key === key ? { key, status: "ready", events: [...previous.events, ...page.events], nextCursor: page.nextCursor } : previous)))
      .catch(() => setState((previous) => (previous.key === key ? { ...previous, status: "error" } : previous)));
  };

  return {
    events: current.events,
    status: current.status,
    hasMore: current.nextCursor !== null,
    loadMore,
    retry: () => {
      if (current.events.length > 0) return loadMore();
      setState({ key, status: "loading", events: [], nextCursor: null });
      setAttempt((count) => count + 1);
    },
  };
}

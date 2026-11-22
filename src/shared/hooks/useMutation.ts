"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage } from "@/shared/lib/api-client";

export type MutationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Mutation {
  /** True while an action runs; a second `run` meanwhile is ignored (double clicks). */
  busy: boolean;
  /** The user-safe message of the last failure, "" after a success or {@link Mutation.clearError}. */
  error: string;
  run: <T>(action: () => Promise<T>) => Promise<MutationResult<T> | null>;
  clearError: () => void;
}

/**
 * One change sent to the API at a time, with its busy flag and failure message
 * ({@link errorMessage}). `run` resolves to null when another action was still running.
 */
export function useMutation(): Mutation {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<MutationResult<T> | null> => {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      return { ok: true, value: await action() };
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      return { ok: false, error: message };
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  const clearError = useCallback(() => setError(""), []);

  return { busy, error, run, clearError };
}

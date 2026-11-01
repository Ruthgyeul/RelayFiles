"use client";

import { useCallback, useRef, useState } from "react";
import { useItemProgress } from "./useItemProgress";
import type { Transfer } from "./transfers-context";

/** What the provider needs from a running batch (uploads also pause). */
export interface Runner {
  cancel: () => void;
  cancelFile: (slot: number) => boolean;
  pause?: () => void;
  resume?: () => void;
}

const failedText = (failed: number, files: number, firstError?: string) => `${failed} of ${files} ${files === 1 ? "file" : "files"} failed${firstError ? ` · ${firstError}` : ""}`;
const stopClock = (transfer: Transfer) => ({ activeMs: transfer.activeMs + (transfer.runningSince ? Date.now() - transfer.runningSince : 0), runningSince: null });

/**
 * The transfers panel's list and the runners behind it: adding a transfer (the panel opens),
 * progress, the end of a batch, pause/resume, cancel and clearing finished ones.
 */
export function useTransferList(notify: (message: string) => void) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [panel, setPanelState] = useState({ open: false, expanded: true });
  const runners = useRef(new Map<string, Runner>());

  const update = useCallback((id: string, patch: (transfer: Transfer) => Partial<Transfer>) => {
    setTransfers((list) => list.map((transfer) => (transfer.id === id ? { ...transfer, ...patch(transfer) } : transfer)));
  }, []);
  const fileEvents = useItemProgress(setTransfers);

  /** Shows a new transfer at the top of the opened panel, with the runner that can pause and cancel it. */
  const add = useCallback((transfer: Transfer, runner?: Runner) => {
    if (runner) runners.current.set(transfer.id, runner);
    setTransfers((list) => [transfer, ...list]);
    setPanelState({ open: true, expanded: true });
  }, []);

  /** Ends a batch: complete, or failed when some files failed (the others are done). */
  const finish = useCallback(
    (id: string, failed: number, firstError?: string) => {
      runners.current.delete(id);
      update(id, (current) => (failed > 0 ? { status: "error", error: failedText(failed, current.files, firstError), ...stopClock(current) } : { status: "complete", done: current.total, ...stopClock(current) }));
      if (failed > 0) notify(failedText(failed, failed, firstError));
    },
    [notify, update],
  );
  /** A batch that stopped as a whole (the server refused it). */
  const fail = useCallback((id: string, message: string) => update(id, (current) => ({ status: "error", error: message, ...stopClock(current) })), [update]);

  const pause = useCallback(
    (id: string, auto: boolean) => {
      runners.current.get(id)?.pause?.();
      update(id, (current) => ({ status: "paused", auto, ...stopClock(current) }));
    },
    [update],
  );
  const resume = useCallback(
    (id: string) => {
      runners.current.get(id)?.resume?.();
      update(id, () => ({ status: "active", auto: false, runningSince: Date.now() }));
    },
    [update],
  );

  const remove = useCallback((id: string) => {
    runners.current.get(id)?.cancel();
    runners.current.delete(id);
    setTransfers((list) => list.filter((entry) => entry.id !== id));
  }, []);
  const cancelItem = useCallback((id: string, key: number) => {
    runners.current.get(id)?.cancelFile(key);
  }, []);
  const clearFinished = useCallback(() => setTransfers((list) => list.filter((entry) => entry.status === "active" || entry.status === "paused")), []);
  const setPanel = useCallback((open: boolean, expanded?: boolean) => setPanelState((current) => ({ open, expanded: expanded ?? current.expanded })), []);

  return { transfers, panel, update, fileEvents, add, finish, fail, pause, resume, remove, cancelItem, clearFinished, setPanel };
}

export type TransferList = ReturnType<typeof useTransferList>;

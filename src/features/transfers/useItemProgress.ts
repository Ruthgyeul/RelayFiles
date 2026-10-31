"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { TRANSFERS } from "@/config/policy";
import { applySent, patchItem, withCancelled, withDone, withStarted } from "./transfer-items";
import type { Transfer } from "./transfers-context";
import type { FileEvents } from "./upload-runner";

/**
 * Per-file runner events → the transfer's `items`. Byte counts arrive many times a second per
 * file, so they are collected and applied every TRANSFERS.progressFlushMs; state changes
 * (started, done, failed, cancelled) apply at once.
 */
export function useItemProgress(setTransfers: Dispatch<SetStateAction<Transfer[]>>): (id: string) => FileEvents {
  const pending = useRef(new Map<string, Map<number, number>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const batch = pending.current;
    pending.current = new Map();
    setTransfers((list) =>
      list.map((transfer) => {
        const sent = batch.get(transfer.id);
        return sent && transfer.items ? { ...transfer, items: applySent(transfer.items, sent, Date.now()) } : transfer;
      }),
    );
  }, [setTransfers]);

  return useCallback(
    (id: string): FileEvents => {
      const change = (apply: (transfer: Transfer) => Transfer) => setTransfers((list) => list.map((transfer) => (transfer.id === id && transfer.items ? apply(transfer) : transfer)));
      return {
        onFileStart: (slot) => change((transfer) => ({ ...transfer, items: withStarted(transfer.items!, slot, Date.now()) })),
        onFileProgress: (slot, sent) => {
          const sentOf = pending.current.get(id) ?? new Map<number, number>();
          sentOf.set(slot, sent);
          pending.current.set(id, sentOf);
          timer.current ??= setTimeout(flush, TRANSFERS.progressFlushMs);
        },
        onFileDone: (slot) => change((transfer) => ({ ...transfer, items: withDone(transfer.items!, slot) })),
        onFileFailed: (slot, message) => change((transfer) => ({ ...transfer, items: patchItem(transfer.items!, slot, { status: "failed", error: message }) })),
        onFileCancelled: (slot) => change((transfer) => withCancelled(transfer, slot)),
      };
    },
    [flush, setTransfers],
  );
}

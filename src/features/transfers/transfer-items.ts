/**
 * Per-file state of a transfer batch (the card's file list): pure updates the provider applies
 * when a runner reports progress, and the numbers the list shows.
 */
import { TRANSFERS } from "@/config/policy";
import type { LinePoint } from "@/shared/ui/LineChart";

export type TransferItemStatus = "queued" | "active" | "done" | "cancelled" | "failed";

export interface TransferItem {
  /** Position in the batch (the runner's slot). */
  key: number;
  /** Relative path ("Trip/a.jpg") or file name. */
  name: string;
  size: number;
  sent: number;
  status: TransferItemStatus;
  error?: string;
  /** Bytes per second, oldest first (the sparkline). */
  samples: number[];
  /** When the newest sample was taken and the byte count at that time. */
  sampledAt: number;
  sampledSent: number;
}

export function initialItems(files: readonly { name: string; size: number }[]): TransferItem[] {
  return files.map((file, key) => ({ key, name: file.name, size: file.size, sent: 0, status: "queued", samples: [], sampledAt: 0, sampledSent: 0 }));
}

/** Replaces one item (others keep their identity, so unchanged rows do not re-render). */
export function patchItem(items: readonly TransferItem[], key: number, patch: Partial<TransferItem>): TransferItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

/** A file starts: its speed is measured from now. */
export function withStarted(items: readonly TransferItem[], key: number, now: number): TransferItem[] {
  return patchItem(items, key, { status: "active", sampledAt: now, sampledSent: 0 });
}

/**
 * Applies batched byte counts; finished or stopped items keep their final numbers. An item adds a
 * speed sample once TRANSFERS.speedSampleMs passed since its last one.
 */
export function applySent(items: readonly TransferItem[], sent: ReadonlyMap<number, number>, now: number): TransferItem[] {
  return items.map((item) => {
    const value = sent.get(item.key);
    if (value === undefined || item.status !== "active" || value <= item.sent) return item;
    const next = { ...item, sent: Math.min(value, item.size) };
    const elapsed = now - item.sampledAt;
    if (elapsed < TRANSFERS.speedSampleMs) return next;
    const speed = ((next.sent - item.sampledSent) / elapsed) * 1_000;
    return { ...next, samples: pushSample(item.samples, speed, TRANSFERS.speedSamples), sampledAt: now, sampledSent: next.sent };
  });
}

/** An item can be cancelled until it finishes. */
export function cancellable(item: Pick<TransferItem, "status">): boolean {
  return item.status === "queued" || item.status === "active";
}

export function itemPercent(item: Pick<TransferItem, "sent" | "size" | "status">): number {
  if (item.status === "done") return 100;
  return item.size > 0 ? Math.floor((item.sent / item.size) * 100) : 0;
}

const count = (items: readonly TransferItem[], status: TransferItemStatus) => items.filter((item) => item.status === status).length;

/** List heading: "3 of 5 files · 1 cancelled · 1 failed". */
export function itemsSummary(items: readonly TransferItem[]): string {
  const cancelled = count(items, "cancelled");
  const failed = count(items, "failed");
  const parts = [`${count(items, "done")} of ${items.length - cancelled} ${items.length - cancelled === 1 ? "file" : "files"}`];
  if (cancelled) parts.push(`${cancelled} cancelled`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** Speed samples (bytes/s) as sparkline points scaled to the fastest sample. */
export function speedPoints(samples: readonly number[]): LinePoint[] {
  const top = Math.max(...samples, 0);
  return samples.map((value) => ({ value: top > 0 ? (value / top) * 100 : 0 }));
}

/** Adds a sample, keeping the newest `keep`. */
export function pushSample(samples: readonly number[], value: number, keep: number): number[] {
  return [...samples, value].slice(-keep);
}

/** Marks a file cancelled and takes it out of the batch's totals (the percentage stays honest). */
export function withCancelled<T extends { items?: TransferItem[]; total: number; files: number }>(transfer: T, key: number): T {
  const item = transfer.items?.find((entry) => entry.key === key);
  if (!transfer.items || !item || !cancellable(item)) return transfer;
  return { ...transfer, items: patchItem(transfer.items, key, { status: "cancelled" }), total: transfer.total - item.size, files: transfer.files - 1 };
}

/** Marks a file finished with all its bytes. */
export function withDone(items: readonly TransferItem[], key: number): TransferItem[] {
  return items.map((item) => (item.key === key ? { ...item, status: "done", sent: item.size } : item));
}

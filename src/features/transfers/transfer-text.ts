import { formatClock, formatSize } from "@/domain/format";

export type TransferStatus = "active" | "paused" | "complete" | "error";

export interface TransferProgress {
  status: TransferStatus;
  files: number;
  folders: number;
  total: number;
  done: number;
  /** Seconds spent transferring (pauses excluded). */
  elapsed: number;
  /** Paused because the connection dropped (resumes by itself). */
  auto: boolean;
  error?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Whole percent done (design `pct`). */
export function percentDone(progress: Pick<TransferProgress, "done" | "total">): number {
  return progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 100;
}

/** Second line of a transfer card (design `meta`). */
export function transferMeta(progress: TransferProgress): string {
  const head = `${progress.folders ? `${plural(progress.folders, "folder")} · ` : ""}${plural(progress.files, "file")} · ${formatSize(progress.total)}`;
  const percent = percentDone(progress);
  switch (progress.status) {
    case "paused":
      return `${head} · ${percent}% · ${progress.auto ? "connection lost, resumes automatically" : "paused"} · continues from ${formatSize(progress.done)}`;
    case "active":
      return `${head} · ${percent}% · ${formatSize(progress.done / Math.max(progress.elapsed, 0.3))}/s`;
    case "error":
      return `${head} · ${progress.error ?? "failed"}`;
    default:
      return `${head} · in ${formatClock(progress.elapsed)} · uploaded`;
  }
}

/** Header summary: "2 active · 1 finished". */
export function panelSummary(active: number, finished: number): string {
  return [active ? `${active} active` : "", finished ? `${finished} finished` : ""].filter(Boolean).join(" · ");
}

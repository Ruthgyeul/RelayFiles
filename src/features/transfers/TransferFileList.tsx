"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { formatSize } from "@/domain/format";
import { cn } from "@/shared/lib/cn";
import { Meter } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { LineChart } from "@/shared/ui/LineChart";
import { kindOf } from "@/shared/ui/node-kind";
import { cancellable, itemPercent, itemsSummary, speedPoints, type TransferItem, type TransferItemStatus } from "./transfer-items";
import { useTransfers, type Transfer } from "./transfers-context";

const BAR_COLOR: Record<TransferItemStatus, string> = {
  queued: "var(--line)",
  active: "var(--accent)",
  done: "var(--color-ok-text)",
  cancelled: "var(--t5)",
  failed: "var(--color-danger-text)",
};
const STATUS_TEXT: Record<Exclude<TransferItemStatus, "active">, string> = { queued: "Waiting", done: "Done", cancelled: "Cancelled", failed: "Failed" };
/** Width of the per-file speed sparkline. */
const SPARKLINE_WIDTH = "w-20";

function detailOf(item: TransferItem, verb: string): string {
  if (item.status === "active") {
    const speed = item.samples.at(-1);
    return `${formatSize(item.sent)} of ${formatSize(item.size)}${speed !== undefined ? ` · ${formatSize(speed)}/s` : ""}`;
  }
  if (item.status === "failed") return `${formatSize(item.size)} · ${item.error ?? "Failed"}`;
  return `${formatSize(item.size)} · ${item.status === "done" ? verb : STATUS_TEXT[item.status]}`;
}

/** One file: name, its own progress bar, bytes and speed (with a sparkline while it runs), cancel. */
const TransferFileRow = memo(function TransferFileRow({ item, verb, onCancel }: { item: TransferItem; verb: string; onCancel?: (key: number) => void }) {
  const kind = kindOf({ type: "file", kind: null, name: item.name });
  const percent = itemPercent(item);
  return (
    <li className="flex flex-col gap-1.5 rounded-lg px-2 py-2 [contain-intrinsic-size:auto_56px] [content-visibility:auto]">
      <div className="flex items-center gap-2">
        <Icon name={kind.icon} size={16} style={{ color: kind.color }} className="shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", item.status === "cancelled" ? "text-t4 line-through" : "text-t1")} title={item.name}>
          {item.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-t3">{item.status === "active" ? `${percent}%` : null}</span>
        {onCancel && cancellable(item) && (
          <button type="button" aria-label={`Cancel ${item.name}`} title="Cancel" onClick={() => onCancel(item.key)} className="flex size-7 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn-h">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <Meter value={percent} height={4} color={BAR_COLOR[item.status]} label={`${item.name} progress`} />
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-[11px]", item.status === "failed" ? "text-danger-text" : "text-t4")}>{detailOf(item, verb)}</span>
        {item.status === "active" && item.samples.length > 1 && <LineChart points={speedPoints(item.samples)} height={20} markLast label={`${item.name} speed`} className={cn("shrink-0", SPARKLINE_WIDTH)} />}
      </div>
    </li>
  );
});

/** The card's dropdown: every file of the batch with its own progress and cancel button. */
export function TransferFileList({ transfer, id }: { transfer: Transfer & { items: TransferItem[] }; id: string }) {
  const { cancelItem } = useTransfers();
  // Rows are memoized; a stable callback keeps unchanged rows from re-rendering on every update.
  const latest = useRef(cancelItem);
  useEffect(() => {
    latest.current = cancelItem;
  });
  const cancel = useCallback((key: number) => latest.current(transfer.id, key), [transfer.id]);
  const running = transfer.status === "active" || transfer.status === "paused";
  const verb = transfer.direction === "up" ? "Uploaded" : "Saved";
  return (
    <div id={id} className="flex flex-col gap-1 rounded-[10px] border border-btn-h bg-elev">
      <span className="px-3 pt-2 text-[11px] font-bold tracking-[.04em] text-t4">{itemsSummary(transfer.items).toUpperCase()}</span>
      <ul className="m-0 flex max-h-[240px] list-none flex-col overflow-auto p-1" aria-label={`Files in ${transfer.title}`}>
        {transfer.items.map((item) => (
          <TransferFileRow key={item.key} item={item} verb={verb} onCancel={running ? cancel : undefined} />
        ))}
      </ul>
    </div>
  );
}

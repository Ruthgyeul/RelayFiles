"use client";

import type { UsageRow } from "@/contracts/admin";
import { formatSize } from "@/domain/format";

const PERCENT = 100;

const countText = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One account of the usage report: name and role, then storage, items, trash, traffic and tokens. */
export function UsageAccountRow({ row }: { row: UsageRow }) {
  const used = Number(row.usedBytes);
  const quota = row.quotaBytes === null ? null : Number(row.quotaBytes);
  const stats = [
    { label: "Storage", value: quota === null ? formatSize(used) : `${formatSize(used)} / ${formatSize(quota)}` },
    { label: "Items", value: `${countText(row.files, "file")} · ${countText(row.folders, "folder")}` },
    { label: "Trash", value: formatSize(Number(row.trashBytes)) },
    { label: "Traffic", value: formatSize(Number(row.trafficBytes)) },
    { label: "API tokens", value: String(row.apiTokens) },
  ];
  return (
    <li className="flex flex-col gap-2 border-t border-ctrl py-2.5 first:border-t-0">
      <span className="flex min-w-0 items-center gap-2 text-[14px] font-bold">
        <span className="truncate">{row.name}</span>
        {row.isAdmin && <span className="rounded-full bg-accent-soft px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.04em] text-accent-text">ADMIN</span>}
        <span className="font-mono text-[12px] font-normal text-t4">{row.id}</span>
      </span>
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-x-3 gap-y-1">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col">
            <dt className="text-[11px] text-t4">{stat.label}</dt>
            <dd className="m-0 truncate text-[13px] text-t2">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/** Share traffic of all accounts per month, one bar each, scaled to the largest month. */
export function MonthBars({ months }: { months: { month: string; bytes: string }[] }) {
  const top = Math.max(0, ...months.map((entry) => Number(entry.bytes)));
  return (
    <ol aria-label="Share traffic per month" className="m-0 flex list-none flex-col gap-1.5 p-0">
      {months.map((entry) => {
        const bytes = Number(entry.bytes);
        return (
          <li key={entry.month} className="grid grid-cols-[64px_1fr_auto] items-center gap-2.5 text-[12px]">
            <span className="font-mono text-t3">{entry.month}</span>
            <span className="h-2 overflow-hidden rounded-full bg-btn">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${top > 0 ? (bytes / top) * PERCENT : 0}%` }} />
            </span>
            <span className="text-right text-t2">{formatSize(bytes)}</span>
          </li>
        );
      })}
    </ol>
  );
}

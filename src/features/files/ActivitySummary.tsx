"use client";

import { SHARE } from "@/config/policy";
import type { LinkEventDto } from "@/contracts/nodes";
import { activitySummary, type ActivityKind } from "@/domain/link-activity";
import { buttonClassName } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { EVENT_LOOK } from "./activity-look";

const TILES: { kind: ActivityKind; label: string }[] = [
  { kind: "open", label: "Opens" },
  { kind: "view", label: "Views" },
  { kind: "play", label: "Plays" },
  { kind: "download", label: "Downloads" },
];

/**
 * Counts per kind of the listed events, overall and in the last 7 and 30 days, and the CSV
 * export of everything kept. A folder's merged log may hold more than the list shows.
 */
export function ActivitySummary({ events, now, csvUrl }: { events: LinkEventDto[]; now: number; csvUrl: string }) {
  const summary = activitySummary(events, now, SHARE.activitySummaryDays);
  const capped = events.length >= SHARE.activityListLimit;
  return (
    <div className="flex flex-col gap-2.5 border-b border-card-line px-5 py-3.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(110px,100%),1fr))] gap-2">
        {TILES.map(({ kind, label }) => (
          <div key={kind} role="group" aria-label={label} className="flex flex-col gap-0.5 rounded-xl bg-sunk px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[12px] text-t3">
              <Icon name={EVENT_LOOK[kind].icon} style={{ color: EVENT_LOOK[kind].color }} />
              {label}
            </span>
            <span className="text-[20px] font-bold">{summary.all[kind]}</span>
            <span className="text-[11px] text-t4">{summary.recent.map(({ days, counts }) => `${counts[kind]} in ${days}d`).join(" · ")}</span>
          </div>
        ))}
      </div>
      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="min-w-[160px] flex-1 text-[12px] text-pretty text-t4">
            {capped ? `Counts cover the newest ${SHARE.activityListLimit} events. The CSV has every kept event.` : "Counts cover every kept event."}
          </span>
          <a href={csvUrl} download className={buttonClassName({ size: 30 })}>
            <Icon name="file-csv" />
            <span>Download CSV</span>
          </a>
        </div>
      )}
    </div>
  );
}

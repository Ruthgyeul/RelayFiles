"use client";

import { useEffect, useMemo, useState } from "react";
import { ADMIN_REPORT } from "@/config/policy";
import type { UsageReport } from "@/contracts/admin";
import { formatSize } from "@/domain/format";
import { rangeEndingToday, sortUsage, USAGE_SORTS, type UsageSort } from "@/domain/usage-report";
import { useNow } from "@/shared/hooks/useNow";
import { Button, buttonClassName } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { OptionChip } from "@/shared/ui/Option";
import { adminApi, usageUrl } from "./api";
import { MonthBars, UsageAccountRow } from "./UsageRows";

/** Accounts shown at a time; the CSV always has every account. */
const PAGE_SIZE = 50;

type Days = (typeof ADMIN_REPORT.rangeChoices)[number];

const rangeLabel = (days: Days) => (days === 365 ? "12 months" : `${days} days`);

/**
 * "Usage report": storage, trash and share traffic per account for the last 30 days, 90 days
 * or 12 months, sortable, with traffic per month and a CSV download. Counters only: no file
 * names, links or addresses.
 */
export function UsageReportCard() {
  const [days, setDays] = useState<Days>(ADMIN_REPORT.defaultDays);
  const [sort, setSort] = useState<UsageSort>("used");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; report: UsageReport | null; failed: boolean }>({ key: "", report: null, failed: false });
  const key = `${days}|${attempt}`;
  // The page time is read once, so every request of one choice asks for the same days.
  const now = useNow(false);
  const range = useMemo(() => rangeEndingToday(days, now), [days, now]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .usage(range)
      .then((report) => !cancelled && setState({ key, report, failed: false }))
      .catch(() => !cancelled && setState({ key, report: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [key, range]);

  const current = state.key === key ? state : { key, report: null, failed: false };
  const report = current.report;
  const rows = useMemo(() => (report ? sortUsage(report.rows, sort) : []), [report, sort]);
  const traffic = report ? report.months.reduce((sum, entry) => sum + Number(entry.bytes), 0) : 0;

  return (
    <section aria-label="Usage report" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="chart-line-up" size={20} className="text-accent-icon" />
        </span>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Usage report</h2>
          <span className="text-[12px] text-pretty text-t4">Storage and trash now, share traffic over the range. No file names, links or addresses.</span>
        </div>
        <a href={usageUrl(range, true)} download className={buttonClassName({ size: 34 })}>
          <Icon name="file-csv" />
          <span>Download CSV</span>
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Range" className="flex flex-wrap gap-1.5">
          {ADMIN_REPORT.rangeChoices.map((choice) => (
            <OptionChip key={choice} variant="filter" selected={days === choice} onClick={() => (setDays(choice), setShown(PAGE_SIZE))}>
              {rangeLabel(choice)}
            </OptionChip>
          ))}
        </div>
        <span className="flex-1" />
        <div role="group" aria-label="Sort by" className="flex flex-wrap gap-1.5">
          {USAGE_SORTS.map((entry) => (
            <OptionChip key={entry.key} variant="filter" selected={sort === entry.key} onClick={() => setSort(entry.key)}>
              {entry.label}
            </OptionChip>
          ))}
        </div>
      </div>
      {report && (
        <div className="flex flex-col gap-2 rounded-xl border border-ctrl bg-elev px-3.5 py-3">
          <span className="text-[13px] font-bold text-t2">
            Share traffic · {report.from} – {report.to} · {formatSize(traffic)}
          </span>
          <MonthBars months={report.months} />
        </div>
      )}
      <div className="flex flex-col rounded-xl border border-ctrl bg-elev px-3.5 py-1">
        {rows.length > 0 && (
          <ol aria-label="Accounts by usage" className="m-0 flex list-none flex-col p-0">
            {rows.slice(0, shown).map((row) => (
              <UsageAccountRow key={row.id} row={row} />
            ))}
          </ol>
        )}
        {!report && !current.failed && <span className="py-6 text-center text-[13px] text-t4">Loading…</span>}
        {current.failed && (
          <div className="flex flex-wrap items-center justify-center gap-2.5 py-4 text-[13px] text-t4">
            Couldn&apos;t load the usage report.
            <Button size={30} icon="arrows-clockwise" onClick={() => setAttempt((count) => count + 1)}>
              Retry
            </Button>
          </div>
        )}
      </div>
      {rows.length > shown && (
        <Button size={36} hoverable onClick={() => setShown((count) => count + PAGE_SIZE)} className="self-center">
          Show more · {rows.length - shown} left
        </Button>
      )}
    </section>
  );
}

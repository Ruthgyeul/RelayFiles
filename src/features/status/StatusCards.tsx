"use client";

import { STATUS } from "@/config/policy";
import type { LatencyHourDto } from "@/contracts/status";
import { jitterRating, latencyRating, latencySummary, latencyTone, lossTone, STATUS_TITLE, type ConnectionStats, type StatusLevel, type Tone } from "@/domain/status";
import { useMounted } from "@/shared/hooks/useMounted";
import { cn } from "@/shared/lib/cn";
import { BarChart } from "@/shared/ui/Display";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { TONE_TEXT } from "./tone";

const PERCENT = 100;

const LEVEL_LOOK: Record<StatusLevel, { box: string; color: string; icon: IconName }> = {
  ok: { box: "bg-ok-bg-strong border-ok-line", color: "text-ok-text", icon: "check-circle" },
  warn: { box: "bg-warn-bg border-warn-line", color: "text-warn-text", icon: "warning" },
  down: { box: "bg-danger-bg-strong border-danger-line", color: "text-danger-text", icon: "x-circle" },
};

/** Overall status (design `st` card): level, last check and "Check now". */
export function OverallCard({ level, lastCheck, onCheck }: { level: StatusLevel; lastCheck: number | null; onCheck: () => void }) {
  const look = LEVEL_LOOK[level];
  const checked = lastCheck === null ? "Checking…" : `Last checked ${new Date(lastCheck).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  return (
    <section aria-label="Overall status" className={cn("flex flex-wrap items-center gap-3.5 rounded-2xl border p-5", look.box)}>
      <Icon name={look.icon} weight="fill" size={34} className={look.color} />
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <h2 className="m-0 text-[20px] font-bold">{STATUS_TITLE[level]}</h2>
        <span className="text-[13px] text-t3">{checked} · checks every 2.5 s while this page is open</span>
      </div>
      <button type="button" onClick={onCheck} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-3.5 text-[13px] font-bold text-t1 hover:bg-btn-h">
        <Icon name="arrows-clockwise" />
        Check now
      </button>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-xl bg-sunk p-3">
      <span className="text-[11px] font-bold tracking-[.04em] text-t4">{label}</span>
      <span className={cn("text-[20px] font-bold", TONE_TEXT[tone])}>{value}</span>
      <span className="text-[12px] text-t4">{sub}</span>
    </div>
  );
}

const BAR_COLOR: Record<Exclude<Tone, "neutral">, string> = { ok: "var(--color-ok-bar)", warn: "var(--color-warn-strong)", bad: "var(--color-danger-icon)" };

function Legend({ color, children }: { color: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 rounded-[2px]" style={{ background: color }} />
      {children}
    </span>
  );
}

interface ConnectionCardProps {
  stats: ConnectionStats;
  online: boolean;
  connectionType: string | null;
  latency: LatencyHourDto[];
}

/** "Your connection": live browser checks and the 48-hour probe latency (design `st.conn`, `st.bars`). */
export function ConnectionCard({ stats, online, connectionType, latency }: ConnectionCardProps) {
  const mounted = useMounted();
  const lastMs = stats.last?.ok ? stats.last.ms : null;
  const jitter = jitterRating(stats.jitter);
  // The current hour shows this browser's live average once it has measured (design).
  const hours = latency.map((hour, i) =>
    i === latency.length - 1 && stats.avg !== null ? { ...hour, avgMs: stats.avg, failed: !!stats.last && !stats.last.ok, live: true } : { ...hour, live: false },
  );
  const summary = latencySummary(hours.map((hour) => (hour.failed ? { avgMs: null, failed: true } : hour.avgMs === null ? null : { avgMs: hour.avgMs, failed: false })));
  const ms = (value: number | null) => (value === null ? "—" : `${value} ms`);

  return (
    <section aria-label="Your connection" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold">Your connection</h2>
        <span className="text-[13px] text-t4">Measured from this browser to the server.</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        <Tile label="NETWORK" value={online ? "Online" : "Offline"} sub={connectionType ?? "Connection type unknown"} tone={online ? "ok" : "bad"} />
        <Tile label="LATENCY" value={ms(lastMs)} sub={latencyRating(lastMs)} tone={latencyTone(lastMs)} />
        <Tile label="AVERAGE" value={ms(stats.avg)} sub={`${stats.okChecks} of ${stats.checks} checks`} tone={latencyTone(stats.avg)} />
        <Tile label="JITTER" value={ms(stats.jitter)} sub={jitter.text} tone={jitter.tone} />
        <Tile label="PACKET LOSS" value={`${stats.loss}%`} sub={stats.loss === 0 ? "No failed checks" : `${stats.checks - stats.okChecks} failed`} tone={lossTone(stats.loss)} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[12px] text-t3">
          <span className="font-bold">Latency · last 48 hours</span>
          <span className="flex flex-wrap gap-2.5">
            <Legend color={BAR_COLOR.ok}>&lt;250 ms</Legend>
            <Legend color={BAR_COLOR.warn}>&lt;500</Legend>
            <Legend color={BAR_COLOR.bad}>slow / failed</Legend>
          </span>
        </div>
        <BarChart
          height={90}
          label="Server latency, last 48 hours"
          className="box-border rounded-xl bg-sunk p-2"
          bars={hours.map((hour) => {
            const when = mounted ? new Date(hour.hour).toLocaleString("en-US", { weekday: "short", hour: "numeric" }) : "";
            if (hour.failed) return { value: PERCENT, color: BAR_COLOR.bad, title: `${when} · unreachable` };
            if (hour.avgMs === null) return { value: null, title: `${when} · No data` };
            const tone = latencyTone(hour.avgMs);
            return {
              value: Math.max(STATUS.minBarPercent, Math.min(PERCENT, (hour.avgMs / STATUS.latencyScaleMs) * PERCENT)),
              color: BAR_COLOR[tone === "neutral" ? "ok" : tone],
              title: `${when} · avg ${hour.avgMs} ms${hour.live ? " (live)" : ""}`,
            };
          })}
        />
        <div className="flex justify-between text-[11px] text-t4">
          <span>48h ago</span>
          <span>24h ago</span>
          <span>Now</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
          {[
            { label: "AVG 48H", value: ms(summary.avg) },
            { label: "BEST", value: ms(summary.best) },
            { label: "PEAK", value: ms(summary.peak) },
            { label: "UNREACHABLE", value: `${summary.unreachable} h` },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5 rounded-[10px] bg-sunk px-2.5 py-2">
              <span className="text-[10px] font-bold tracking-[.05em] text-t4">{item.label}</span>
              <span className="text-[15px] font-bold">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

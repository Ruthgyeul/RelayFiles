"use client";

import { useEffect, useState } from "react";
import type { ServerSnapshot, ServiceStatus } from "@/contracts/server-metrics";
import { formatSize } from "@/domain/format";
import { bandwidthStats, formatUptime, linkLabel } from "@/domain/server";
import { cn } from "@/shared/lib/cn";
import { BarChart } from "@/shared/ui/Display";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

const PERCENT = 100;
const BITS_PER_BYTE = 8;
const BYTES_PER_MBPS = 1_000_000 / BITS_PER_BYTE;
const SLOTS = 60;
const SECONDS_PER_MINUTE = 60;
/** Bars never shrink below this, so quiet minutes stay visible (design). */
const MIN_BAR_PERCENT = 3;

function MetricCard({ icon, box, color, bar, label, value, sub, percent }: { icon: IconName; box: string; color: string; bar: string; label: string; value: string; sub: string; percent: number }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5 rounded-2xl border border-card-line bg-card p-4">
      <span className="flex items-center gap-2.5 text-[13px] font-bold text-t2">
        <span className={cn("flex size-[30px] items-center justify-center rounded-lg", box)}>
          <Icon name={icon} className={color} />
        </span>
        {label}
      </span>
      <span className="text-[24px] font-bold">{value}</span>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-line" role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={Math.round(percent)}>
        <div className={cn("h-1.5 rounded-[3px] transition-[width] duration-[600ms]", bar)} style={{ width: `${Math.min(PERCENT, Math.max(0, percent)).toFixed(1)}%` }} />
      </div>
      <span className="text-[12px] text-t4">{sub}</span>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-xl bg-sunk p-3">
      <span className="text-[11px] font-bold tracking-[.04em] text-t4">{label}</span>
      <span className="text-[18px] font-bold">{value}</span>
    </div>
  );
}

const STATUS: Record<ServiceStatus, { label: string; pill: string; dot: string }> = {
  running: { label: "RUNNING", pill: "bg-ok-bg text-ok-text", dot: "bg-ok" },
  healthy: { label: "HEALTHY", pill: "bg-ok-bg text-ok-text", dot: "bg-ok" },
  scheduled: { label: "SCHEDULED", pill: "bg-accent-soft text-accent-text", dot: "bg-accent-icon" },
  stopped: { label: "STOPPED", pill: "bg-danger-bg text-danger-text", dot: "bg-danger-icon" },
  offline: { label: "OFFLINE", pill: "bg-danger-bg text-danger-text", dot: "bg-danger-icon" },
  failing: { label: "FAILING", pill: "bg-danger-bg text-danger-text", dot: "bg-danger-icon" },
  unknown: { label: "UNAVAILABLE", pill: "bg-btn text-t3", dot: "bg-t4" },
};

/** Live server measurements (design Server page): resources, bandwidth, live tiles, services. */
export function ServerMetrics({ initial }: { initial: ServerSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    const source = new EventSource("/api/admin/server/stream");
    source.onmessage = (event: MessageEvent<string>) => setSnapshot(JSON.parse(event.data) as ServerSnapshot);
    return () => source.close();
  }, []);

  const { disk, cpu, memory, network, live } = snapshot;
  const link = linkLabel(network.linkMbps);
  const samples = snapshot.history.map((sample) => sample.outPerSec);
  const shown = [...samples.slice(-(SLOTS - 1)), network.outPerSec];
  const peak = Math.max(...shown, 1);
  const padded: (number | null)[] = [...Array<null>(SLOTS - shown.length).fill(null), ...shown];
  const minutesPerSlot = snapshot.sampleSeconds / SECONDS_PER_MINUTE;
  const stats = bandwidthStats(samples, snapshot.sampleSeconds);
  const percentOf = (used: number, total: number) => (total > 0 ? (used / total) * PERCENT : 0);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <MetricCard
          icon="hard-drives"
          box="bg-warn-bg-orange"
          color="text-warn-orange"
          bar="bg-warn-orange"
          label="Disk"
          value={disk ? formatSize(disk.usedBytes) : "—"}
          sub={disk ? `of ${formatSize(disk.totalBytes)} · ${Math.round(percentOf(disk.usedBytes, disk.totalBytes))}% used` : "No storage volume mounted"}
          percent={disk ? percentOf(disk.usedBytes, disk.totalBytes) : 0}
        />
        <MetricCard icon="cpu" box="bg-accent-soft" color="text-accent-icon" bar="bg-accent-icon" label="CPU" value={`${cpu.percent}%`} sub={`${cpu.cores} cores · load ${cpu.load.toFixed(2)}`} percent={cpu.percent} />
        <MetricCard
          icon="memory"
          box="bg-memory-bg"
          color="text-kind-audio"
          bar="bg-kind-audio"
          label="Memory"
          value={formatSize(memory.usedBytes)}
          sub={`of ${formatSize(memory.totalBytes)} · ${Math.round(percentOf(memory.usedBytes, memory.totalBytes))}%`}
          percent={percentOf(memory.usedBytes, memory.totalBytes)}
        />
        <MetricCard
          icon="arrow-up-right"
          box="bg-ok-bg"
          color="text-kind-image"
          bar="bg-kind-image"
          label="Network out"
          value={`${formatSize(network.outPerSec)}/s`}
          sub={`In ${formatSize(network.inPerSec)}/s${link ? ` · ${link}` : ""}`}
          percent={network.linkMbps ? percentOf(network.outPerSec, network.linkMbps * BYTES_PER_MBPS) : 0}
        />
      </div>

      <section aria-label="Outbound bandwidth" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
        <div className="flex items-center gap-2.5">
          <h2 className="m-0 flex-1 text-[17px] font-bold">Outbound bandwidth · last hour</h2>
          <span className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[.06em] text-ok-text">
            <span className="size-2 rounded-full bg-ok" />
            LIVE
          </span>
        </div>
        <BarChart
          height={120}
          label="Outbound bandwidth, last hour"
          bars={padded.map((value, index) => ({
            value: value === null ? null : Math.max(MIN_BAR_PERCENT, (value / peak) * PERCENT),
            opacity: index === SLOTS - 1 ? 1 : 0.55,
            title: value === null ? "No data" : `${index === SLOTS - 1 ? "Now" : `${Math.round((SLOTS - 1 - index) * minutesPerSlot)} min ago`} · ${formatSize(value)}/s`,
          }))}
        />
        <div className="flex justify-between text-[12px] text-t4">
          <span>60 min ago</span>
          <span>30 min ago</span>
          <span>now</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
          <Tile label="AVG 1H" value={`${formatSize(stats.avg)}/s`} />
          <Tile label="PEAK 1H" value={`${formatSize(stats.peak)}/s`} />
          <Tile label="SENT 1H" value={formatSize(stats.sent)} />
          <Tile label="ACTIVE STREAMS" value={String(live.streams)} />
          <Tile label="TRANSFERS" value={String(live.transfers)} />
          <Tile label="ACCOUNTS" value={String(live.accounts)} />
          <Tile label="UPTIME" value={formatUptime(live.uptimeSec)} />
        </div>
      </section>

      <section aria-label="Services" className="flex flex-col gap-1.5 rounded-2xl border border-card-line bg-card p-5">
        <h2 className="m-0 mb-1.5 text-[17px] font-bold">Services</h2>
        {snapshot.services.map((service) => (
          <div key={service.name} className="flex items-center gap-3 border-t border-card-line py-2.5">
            <span className={cn("size-2 shrink-0 rounded-full", STATUS[service.status].dot)} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-bold">{service.name}</span>
              <span className="text-[12px] text-t4">{service.detail}</span>
            </div>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-[.04em]", STATUS[service.status].pill)}>{STATUS[service.status].label}</span>
          </div>
        ))}
      </section>
    </>
  );
}

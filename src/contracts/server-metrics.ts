import type { RateSeries } from "@/domain/server";

export type ServiceStatus = "running" | "scheduled" | "healthy" | "stopped" | "offline" | "failing" | "unknown";

export interface ServiceRow {
  name: string;
  detail: string;
  status: ServiceStatus;
}

/** Read and write rate of one physical disk (`sda`, `nvme0n1`) over the history window. */
export interface DiskActivity {
  name: string;
  /** Model the kernel reports, or null. */
  model: string | null;
  read: RateSeries;
  write: RateSeries;
}

/** One Server page snapshot (sent every 1.5 s while the page is open). */
export interface ServerSnapshot {
  /** Storage volumes together; null when no volume is mounted. */
  disk: { usedBytes: number; totalBytes: number } | null;
  cpu: { percent: number; cores: number; load: number };
  memory: { usedBytes: number; totalBytes: number };
  /** Bytes per second right now; link speed in Mbps when the system reports it. */
  network: { outPerSec: number; inPerSec: number; linkMbps: number | null };
  /** Outbound bytes/s over the last METRICS.historyHours, one bar per hour. */
  bandwidth: RateSeries;
  /** Physical disks the worker measured in that window, by name. */
  disks: DiskActivity[];
  live: { streams: number; transfers: number; accounts: number; uptimeSec: number };
  services: ServiceRow[];
}

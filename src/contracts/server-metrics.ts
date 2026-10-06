export type ServiceStatus = "running" | "scheduled" | "healthy" | "stopped" | "offline" | "failing" | "unknown";

export interface ServiceRow {
  name: string;
  detail: string;
  status: ServiceStatus;
}

/** One Server page snapshot (sent every 1.5 s while the page is open). */
export interface ServerSnapshot {
  /** Storage volumes together; null when no volume is mounted. */
  disk: { usedBytes: number; totalBytes: number } | null;
  cpu: { percent: number; cores: number; load: number };
  memory: { usedBytes: number; totalBytes: number };
  /** Bytes per second right now; link speed in Mbps when the system reports it. */
  network: { outPerSec: number; inPerSec: number; linkMbps: number | null };
  /** Outbound bytes/s per sample, oldest first (one per METRICS_SAMPLE_INTERVAL_SEC). */
  history: { at: string; outPerSec: number }[];
  sampleSeconds: number;
  live: { streams: number; transfers: number; accounts: number; uptimeSec: number };
  services: ServiceRow[];
}

/**
 * Server page rules (design `srv`): uptime, the cleanup schedule label, bandwidth summary
 * and the network link label. Values come from real measurements, never generated.
 */

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/** "23d 4h", "4h 12m" or "12m" (design UPTIME tile). */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / DAY);
  const hours = Math.floor((seconds % DAY) / HOUR);
  const minutes = Math.floor((seconds % HOUR) / MINUTE);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** "Daily 04:00" for a daily cron like "0 4 * * *"; other schedules are shown as written. */
export function cronLabel(cron: string): string {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron.trim());
  if (!match) return `Schedule ${cron}`;
  const [, minute = "0", hour = "0"] = match;
  return `Daily ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** Average, peak (bytes/s) and total bytes of per-minute samples (design `srvBw`). */
export function bandwidthStats(samples: readonly number[], secondsPerSample: number): { avg: number; peak: number; sent: number } {
  if (samples.length === 0) return { avg: 0, peak: 0, sent: 0 };
  const total = samples.reduce((sum, value) => sum + value, 0);
  return { avg: total / samples.length, peak: Math.max(...samples), sent: total * secondsPerSample };
}

/** "1 Gbps link" / "100 Mbps link", or null when the speed is unknown. */
export function linkLabel(mbps: number | null): string | null {
  if (!mbps || mbps <= 0) return null;
  const MBPS_PER_GBPS = 1_000;
  return mbps >= MBPS_PER_GBPS ? `${mbps / MBPS_PER_GBPS} Gbps link` : `${mbps} Mbps link`;
}

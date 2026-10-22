import { roundDecimals } from "./format";

/**
 * Server page rules (design `srv`): uptime, the cleanup schedule label, hourly bandwidth
 * and disk rates, and the network link label. Values come from real measurements, never generated.
 */

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const MS_PER_SECOND = 1_000;
/** /proc/diskstats counts 512-byte sectors whatever the device's own sector size. */
const DISKSTATS_SECTOR_BYTES = 512;

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

/** One rate measurement: when (epoch ms) and bytes per second averaged over its interval. */
export interface RateSample {
  at: number;
  perSec: number;
}

/** One hour of a rate: mean and highest bytes/s of its samples. */
export interface RateHour {
  avg: number;
  peak: number;
}

/** Hourly bars, oldest first with the current hour last, and the summary of the whole window. */
export interface RateSeries {
  hours: (RateHour | null)[];
  avg: number;
  peak: number;
  /** Bytes moved over the window. */
  total: number;
}

/** Average, peak (bytes/s) and total bytes of samples taken every `secondsPerSample` (design `srvBw`). */
export function rateStats(samples: readonly number[], secondsPerSample: number): { avg: number; peak: number; total: number } {
  if (samples.length === 0) return { avg: 0, peak: 0, total: 0 };
  const total = samples.reduce((sum, value) => sum + value, 0);
  return { avg: roundDecimals(total / samples.length), peak: roundDecimals(Math.max(...samples)), total: roundDecimals(total * secondsPerSample) };
}

/**
 * Groups samples into the last `hours` wall-clock hours (the current one last); an hour
 * without samples is null. Samples outside the window are ignored.
 */
export function rateSeries(samples: readonly RateSample[], now: number, hours: number, secondsPerSample: number): RateSeries {
  const hourMs = HOUR * MS_PER_SECOND;
  const first = (Math.floor(now / hourMs) - (hours - 1)) * hourMs;
  const buckets = Array.from({ length: hours }, () => ({ sum: 0, count: 0, peak: 0 }));
  const inWindow: number[] = [];
  for (const sample of samples) {
    const bucket = sample.at >= first ? buckets[Math.floor((sample.at - first) / hourMs)] : undefined;
    if (!bucket) continue;
    bucket.sum += sample.perSec;
    bucket.count += 1;
    bucket.peak = Math.max(bucket.peak, sample.perSec);
    inWindow.push(sample.perSec);
  }
  return {
    hours: buckets.map((bucket) => (bucket.count > 0 ? { avg: roundDecimals(bucket.sum / bucket.count), peak: roundDecimals(bucket.peak) } : null)),
    ...rateStats(inWindow, secondsPerSample),
  };
}

/** Per-second rate between two readings of a growing counter; null when it went back (reboot) or no time passed. */
export function counterRate(before: number, after: number, seconds: number): number | null {
  if (seconds <= 0 || after < before) return null;
  return roundDecimals((after - before) / seconds);
}

/** Bytes read and written so far by each block device listed in /proc/diskstats. */
export function parseDiskstats(text: string): Map<string, { readBytes: number; writeBytes: number }> {
  // Fields: major minor name reads merged sectorsRead msReading writes merged sectorsWritten ...
  const NAME = 2;
  const SECTORS_READ = 5;
  const SECTORS_WRITTEN = 9;
  const devices = new Map<string, { readBytes: number; writeBytes: number }>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const name = fields[NAME];
    const read = Number(fields[SECTORS_READ]);
    const written = Number(fields[SECTORS_WRITTEN]);
    if (!name || !Number.isFinite(read) || !Number.isFinite(written) || fields.length <= SECTORS_WRITTEN) continue;
    devices.set(name, { readBytes: read * DISKSTATS_SECTOR_BYTES, writeBytes: written * DISKSTATS_SECTOR_BYTES });
  }
  return devices;
}

/** "1 Gbps link" / "100 Mbps link", or null when the speed is unknown. */
export function linkLabel(mbps: number | null): string | null {
  if (!mbps || mbps <= 0) return null;
  const MBPS_PER_GBPS = 1_000;
  return mbps >= MBPS_PER_GBPS ? `${mbps / MBPS_PER_GBPS} Gbps link` : `${mbps} Mbps link`;
}

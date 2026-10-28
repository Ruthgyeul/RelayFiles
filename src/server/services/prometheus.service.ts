import "server-only";
import { getEnv } from "@/config/env";
import { METRICS, MS, STATUS } from "@/config/policy";
import type { ServiceStatus } from "@/contracts/server-metrics";
import { gauge, renderPrometheus, type MetricFamily } from "@/domain/prometheus";
import { cached, cacheKey } from "../cache/cached";
import { db } from "../db/client";
import { mediaQueueCounts } from "../jobs/queue";
import { logger } from "../logger";
import { activeCount } from "../metrics/activity";
import { counterValue } from "../metrics/counters";
import { readDiskHistory } from "../metrics/history";
import { serviceRows } from "../metrics/services";
import { storageCapacity } from "../metrics/storage";
import { cpuMemory, networkRates, uptimeSeconds } from "../metrics/system";
import { slotsHeld } from "../redis-semaphore";
import { countAccounts } from "../repositories/account.repo";
import { latestBackupCheck } from "../repositories/backup-check.repo";
import { latestSamples } from "../repositories/health.repo";
import { trafficTotalOn } from "../repositories/traffic.repo";

/** Service rows that mean "working" (the Server page's green states). */
const UP_STATES: ReadonlySet<ServiceStatus> = new Set(["running", "scheduled", "healthy"]);
const MS_PER_SEC = MS.second;

/** Labels are machine words only: service and component names, disk devices, job states. */
const labelOf = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "");

async function systemFamilies(): Promise<MetricFamily[]> {
  const [{ cpu, memory }, network, disk] = await Promise.all([cpuMemory(), networkRates(), storageCapacity()]);
  return [
    gauge("relayfiles_cpu_usage_percent", "CPU in use on the host, percent.", cpu.percent),
    gauge("relayfiles_cpu_cores", "CPU cores of the host.", cpu.cores),
    gauge("relayfiles_load1", "One-minute load average of the host.", cpu.load),
    gauge("relayfiles_memory_used_bytes", "Memory in use on the host.", memory.usedBytes),
    gauge("relayfiles_memory_total_bytes", "Memory of the host.", memory.totalBytes),
    gauge("relayfiles_network_transmit_bytes_per_second", "Bytes sent per second by the host right now.", network.outPerSec),
    gauge("relayfiles_network_receive_bytes_per_second", "Bytes received per second by the host right now.", network.inPerSec),
    gauge("relayfiles_storage_used_bytes", "Bytes used on the storage volumes together.", disk?.usedBytes ?? null),
    gauge("relayfiles_storage_total_bytes", "Size of the storage volumes together.", disk?.totalBytes ?? null),
    gauge("relayfiles_host_uptime_seconds", "Seconds since the host booted.", uptimeSeconds()),
  ];
}

async function diskFamilies(): Promise<MetricFamily[]> {
  const latest = (await readDiskHistory()).at(-1);
  const disks = latest?.disks ?? [];
  return [
    { name: "relayfiles_disk_read_bytes_per_second", help: "Read rate of each physical disk in the worker's latest sample.", type: "gauge", samples: disks.map((disk) => ({ labels: { disk: disk.name }, value: disk.readPerSec })) },
    { name: "relayfiles_disk_write_bytes_per_second", help: "Write rate of each physical disk in the worker's latest sample.", type: "gauge", samples: disks.map((disk) => ({ labels: { disk: disk.name }, value: disk.writePerSec })) },
  ];
}

async function activityFamilies(now: Date): Promise<MetricFamily[]> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [streams, uploads, accounts, servedToday, transcoding, transcodes] = await Promise.all([
    activeCount("stream", now.getTime()),
    activeCount("upload", now.getTime()),
    countAccounts(db()),
    trafficTotalOn(db(), today),
    slotsHeld("transcode"),
    counterValue("transcodes_started"),
  ]);
  return [
    gauge("relayfiles_active_streams", "Streams played within the last minute.", streams),
    gauge("relayfiles_active_uploads", "Uploads that sent data within the last minute.", uploads),
    gauge("relayfiles_accounts", "Accounts on this server.", accounts),
    gauge("relayfiles_served_bytes_today", "Bytes served from files today (UTC), all accounts together.", Number(servedToday)),
    gauge("relayfiles_transcodes_running", "Live video conversions running now (shared VIDEO_TRANSCODE_MAX slots).", transcoding),
    { name: "relayfiles_transcodes_started_total", help: "Live video conversions started.", type: "counter", samples: [{ value: transcodes }] },
  ];
}

async function queueFamilies(): Promise<MetricFamily[]> {
  const counts = await mediaQueueCounts();
  return [{ name: "relayfiles_media_queue_jobs", help: "Media jobs (thumbnails, previews, stripped copies) by state.", type: "gauge", samples: Object.entries(counts).map(([state, value]) => ({ labels: { state }, value })) }];
}

async function healthFamilies(now: Date): Promise<MetricFamily[]> {
  const fresh = new Date(now.getTime() - STATUS.freshProbes * getEnv("jobs").HEALTH_PROBE_INTERVAL_SEC * MS_PER_SEC);
  const [probes, services, backup] = await Promise.all([
    latestSamples(db(), fresh),
    cached(cacheKey.serverServices(), METRICS.servicesCacheSec, () => serviceRows(now)),
    latestBackupCheck(db()),
  ]);
  return [
    { name: "relayfiles_health_up", help: "Latest health probe of each Status page component (1 = ok).", type: "gauge", samples: [...probes].map(([component, ok]) => ({ labels: { component }, value: ok ? 1 : 0 })) },
    {
      name: "relayfiles_service_up",
      help: "Server page services (1 = running, scheduled or healthy).",
      type: "gauge",
      samples: services.filter((row) => row.status !== "unknown").map((row) => ({ labels: { service: labelOf(row.name) }, value: UP_STATES.has(row.status) ? 1 : 0 })),
    },
    gauge("relayfiles_backup_check_ok", "Result of the latest backup verification (1 = usable).", backup ? (backup.ok ? 1 : 0) : null),
    gauge("relayfiles_backup_check_timestamp_seconds", "When the latest backup verification ran.", backup ? backup.checkedAt.getTime() / MS_PER_SEC : null),
  ];
}

/**
 * Everything /metrics reports, as Prometheus text. Each group of sources is read on its own:
 * one that fails (Redis down, say) leaves its metrics out and counts in
 * relayfiles_scrape_errors instead of failing the scrape.
 */
export async function prometheusMetrics(now: Date = new Date()): Promise<string> {
  const groups = await Promise.allSettled([systemFamilies(), diskFamilies(), activityFamilies(now), queueFamilies(), healthFamilies(now)]);
  const families: MetricFamily[] = [];
  let errors = 0;
  for (const group of groups) {
    if (group.status === "fulfilled") families.push(...group.value);
    else {
      errors++;
      logger.warn("metrics source failed", { error: group.reason });
    }
  }
  families.push(gauge("relayfiles_scrape_errors", "Metric sources that could not be read for this scrape.", errors), gauge("relayfiles_up", "1 while the app answers.", 1));
  return renderPrometheus(families);
}

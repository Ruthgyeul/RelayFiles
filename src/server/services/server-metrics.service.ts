import "server-only";
import { getEnv } from "@/config/env";
import { METRICS } from "@/config/policy";
import type { ServerSnapshot } from "@/contracts/server-metrics";
import { cached } from "../cache/cached";
import { db } from "../db/client";
import { activeCount } from "../metrics/activity";
import { readHistory } from "../metrics/history";
import { serviceRows } from "../metrics/services";
import { cpuMemory, linkMbps, networkRates, uptimeSeconds } from "../metrics/system";
import { listActiveVolumes } from "../repositories/volume.repo";
import { driverFor } from "../storage/registry";

async function diskUsage(): Promise<ServerSnapshot["disk"]> {
  const volumes = await listActiveVolumes(db());
  if (volumes.length === 0) return null;
  let total = 0n;
  let available = 0n;
  for (const volume of volumes) {
    const space = await driverFor(volume).space().catch(() => null);
    if (!space) continue;
    total += space.total;
    available += space.available;
  }
  return total > 0n ? { usedBytes: Number(total - available), totalBytes: Number(total) } : null;
}

/** Everything the Server page shows besides its settings, measured now. */
export async function serverSnapshot(now: Date = new Date()): Promise<ServerSnapshot> {
  const [system, network, link, disk, history, streams, transfers, accounts, services] = await Promise.all([
    cpuMemory(),
    networkRates(),
    linkMbps(),
    diskUsage(),
    readHistory(),
    activeCount("stream", now.getTime()),
    activeCount("upload", now.getTime()),
    db().account.count(),
    cached("metrics:services", METRICS.servicesCacheSec, () => serviceRows(now)),
  ]);
  return {
    disk,
    ...system,
    network: { ...network, linkMbps: link },
    history,
    sampleSeconds: getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC,
    live: { streams, transfers, accounts, uptimeSec: uptimeSeconds() },
    services,
  };
}

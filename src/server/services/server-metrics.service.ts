import "server-only";
import { getEnv } from "@/config/env";
import { METRICS } from "@/config/policy";
import type { ServerSnapshot } from "@/contracts/server-metrics";
import { cached, cacheKey } from "../cache/cached";
import { db } from "../db/client";
import { activeCount } from "../metrics/activity";
import { readHistory } from "../metrics/history";
import { serviceRows } from "../metrics/services";
import { storageCapacity } from "../metrics/storage";
import { cpuMemory, linkMbps, networkRates, uptimeSeconds } from "../metrics/system";

/** Everything the Server page shows besides its settings, measured now. */
export async function serverSnapshot(now: Date = new Date()): Promise<ServerSnapshot> {
  const [system, network, link, disk, history, streams, transfers, accounts, services] = await Promise.all([
    cpuMemory(),
    networkRates(),
    linkMbps(),
    storageCapacity(),
    readHistory(),
    activeCount("stream", now.getTime()),
    activeCount("upload", now.getTime()),
    db().account.count(),
    cached(cacheKey.serverServices(), METRICS.servicesCacheSec, () => serviceRows(now)),
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

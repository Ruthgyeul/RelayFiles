import "server-only";
import { getEnv } from "@/config/env";
import { METRICS } from "@/config/policy";
import type { DiskActivity, ServerSnapshot } from "@/contracts/server-metrics";
import { rateSeries, type RateSample, type RateSeries } from "@/domain/server";
import { cached, cacheKey } from "../cache/cached";
import { db } from "../db/client";
import { activeCount } from "../metrics/activity";
import { diskModel } from "../metrics/disks";
import { readDiskHistory, readHistory } from "../metrics/history";
import { serviceRows } from "../metrics/services";
import { storageCapacity } from "../metrics/storage";
import { cpuMemory, linkMbps, networkRates, uptimeSeconds } from "../metrics/system";

/** Hourly outbound bandwidth and per-disk read/write over the last METRICS.historyHours. */
async function hourlyHistory(now: Date): Promise<{ bandwidth: RateSeries; disks: DiskActivity[] }> {
  const secondsPerSample = getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC;
  const series = (samples: RateSample[]) => rateSeries(samples, now.getTime(), METRICS.historyHours, secondsPerSample);
  const [network, diskSamples] = await Promise.all([readHistory(), readDiskHistory()]);
  const names = [...new Set(diskSamples.flatMap((sample) => sample.disks.map((disk) => disk.name)))].sort();
  const disks = await Promise.all(
    names.map(async (name) => {
      const rates = diskSamples.flatMap((sample) => {
        const disk = sample.disks.find((entry) => entry.name === name);
        return disk ? [{ at: Date.parse(sample.at), read: disk.readPerSec, write: disk.writePerSec }] : [];
      });
      return {
        name,
        model: await diskModel(name),
        read: series(rates.map((rate) => ({ at: rate.at, perSec: rate.read }))),
        write: series(rates.map((rate) => ({ at: rate.at, perSec: rate.write }))),
      };
    }),
  );
  return { bandwidth: series(network.map((sample) => ({ at: Date.parse(sample.at), perSec: sample.outPerSec }))), disks };
}

/** Everything the Server page shows besides its settings, measured now. */
export async function serverSnapshot(now: Date = new Date()): Promise<ServerSnapshot> {
  const [system, network, link, disk, history, streams, transfers, accounts, services] = await Promise.all([
    cpuMemory(),
    networkRates(),
    linkMbps(),
    storageCapacity(),
    cached(cacheKey.serverHistory(), METRICS.historyCacheSec, () => hourlyHistory(now)),
    activeCount("stream", now.getTime()),
    activeCount("upload", now.getTime()),
    db().account.count(),
    cached(cacheKey.serverServices(), METRICS.servicesCacheSec, () => serviceRows(now)),
  ]);
  return {
    disk,
    ...system,
    network: { ...network, linkMbps: link },
    ...history,
    live: { streams, transfers, accounts, uptimeSec: uptimeSeconds() },
    services,
  };
}

import "server-only";
import { STATUS } from "@/config/policy";
import type { ComponentStatus, Health } from "@/contracts/health";
import { db } from "../db/client";
import { logger } from "../logger";
import { workerAlive } from "../metrics/history";
import { redis } from "../redis";
import { configuredVolumeRoot } from "../storage/registry";
import { readVolumeMarker } from "../storage/volume";
import { pingClamd, scanningEnabled } from "../scan/clamd";

async function probe(name: string, check: () => Promise<boolean>): Promise<ComponentStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), STATUS.healthCheckTimeoutMs);
    });
    return (await Promise.race([check(), timeout])) ? "ok" : "down";
  } catch (error) {
    logger.warn("health check failed", { component: name, error });
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Overall status: down if the database is down, degraded if anything else the app serves from
 * is. The worker is left out (see `components.worker`): it is watched on its own (worker-watch.ts).
 */
function overallStatus(components: Health["components"]): ComponentStatus {
  if (components.database === "down") return "down";
  const served = Object.entries(components).filter(([name]) => name !== "worker");
  return served.every(([, status]) => status === "ok") ? "ok" : "degraded";
}

/**
 * Checks PostgreSQL, Redis, the storage volume marker and the worker heartbeat (the app version
 * is not part of it: anyone may ask).
 */
export async function checkHealth(now: Date = new Date()): Promise<Health> {
  const [database, cache, storage, worker, scanner] = await Promise.all([
    probe("database", async () => {
      await db().$queryRaw`SELECT 1`;
      return true;
    }),
    probe("redis", async () => (await redis().ping()) === "PONG"),
    probe("storage", async () => (await readVolumeMarker(configuredVolumeRoot())) !== null),
    probe("worker", workerAlive),
    scanningEnabled() ? probe("scanner", () => pingClamd(STATUS.healthCheckTimeoutMs)) : Promise.resolve(null),
  ]);
  const components = { database, redis: cache, storage, worker, ...(scanner ? { scanner } : {}) };
  return { status: overallStatus(components), time: now.toISOString(), components };
}

let shared: { at: number; result: Promise<Health> } | null = null;

/**
 * /api/health: requests within STATUS.healthCacheMs share one check (the first one's, even
 * while it runs), so polling the public endpoint cannot multiply the database, Redis and disk
 * round trips.
 */
export function sharedHealth(now: number = Date.now()): Promise<Health> {
  if (!shared || now - shared.at >= STATUS.healthCacheMs) shared = { at: now, result: checkHealth(new Date(now)) };
  return shared.result;
}

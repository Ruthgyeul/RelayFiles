import "server-only";
import { APP_VERSION } from "@/config/version";
import type { ComponentStatus, Health } from "@/contracts/health";
import { db } from "../db/client";
import { logger } from "../logger";
import { redis } from "../redis";
import { configuredVolumeRoot } from "../storage/registry";
import { readVolumeMarker } from "../storage/volume";

const CHECK_TIMEOUT_MS = 2_000;

async function probe(name: string, check: () => Promise<boolean>): Promise<ComponentStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
    });
    return (await Promise.race([check(), timeout])) ? "ok" : "down";
  } catch (error) {
    logger.warn("health check failed", { component: name, error });
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** Overall status: down if the database is down, degraded if anything else is. */
export function overallStatus(components: Health["components"]): ComponentStatus {
  if (components.database === "down") return "down";
  return Object.values(components).every((status) => status === "ok") ? "ok" : "degraded";
}

/** Checks PostgreSQL, Redis and the storage volume marker. */
export async function checkHealth(now: Date = new Date()): Promise<Health> {
  const [database, cache, storage] = await Promise.all([
    probe("database", async () => {
      await db().$queryRaw`SELECT 1`;
      return true;
    }),
    probe("redis", async () => (await redis().ping()) === "PONG"),
    probe("storage", async () => (await readVolumeMarker(configuredVolumeRoot())) !== null),
  ]);
  const components = { database, redis: cache, storage };
  return { status: overallStatus(components), version: APP_VERSION, time: now.toISOString(), components };
}

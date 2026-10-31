import "server-only";
import { Redis } from "ioredis";
import { getEnv, redisUrlOf } from "@/config/env";

function createRedis(): Redis {
  const env = getEnv("redis");
  return new Redis(redisUrlOf(env), {
    keyPrefix: env.REDIS_KEY_PREFIX,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
}

const globalForRedis = globalThis as unknown as { relayRedis?: Redis };

/**
 * Shared Redis connection. Every key gets REDIS_KEY_PREFIX (e.g. `rf:v1:`) so a cache
 * format change can bump the prefix instead of deleting keys (docs/architecture.md "버전 관리").
 */
export function redis(): Redis {
  globalForRedis.relayRedis ??= createRedis();
  return globalForRedis.relayRedis;
}

/** Closes the shared connection if one was opened (scripts, so the process can exit). */
export function closeRedis(): void {
  globalForRedis.relayRedis?.disconnect();
  globalForRedis.relayRedis = undefined;
}

/**
 * Increments a counter that expires `windowSeconds` after its first increment. INCR and
 * EXPIRE run in one transaction, so a crash between them cannot leave a counter that never
 * expires (and an address locked out for good).
 */
export async function countInWindow(key: string, windowSeconds: number): Promise<number> {
  const results = await redis().multi().incr(key).expire(key, windowSeconds, "NX").exec();
  const [error, value] = results?.[0] ?? [new Error("Redis transaction was aborted."), 0];
  if (error) throw error;
  return Number(value);
}

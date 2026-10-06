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
 * format change can bump the prefix instead of deleting keys (docs/plan.md §13.8 ⑦).
 */
export function redis(): Redis {
  globalForRedis.relayRedis ??= createRedis();
  return globalForRedis.relayRedis;
}

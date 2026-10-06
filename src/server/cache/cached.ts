import "server-only";
import type { Redis } from "ioredis";
import { redis } from "../redis";
import { logger } from "../logger";

/**
 * Read-through cache for derived data (folder sizes, path lookups, admin stats).
 * Redis only ever holds data that can be rebuilt from PostgreSQL or the disk, so a cache
 * failure falls back to the loader instead of failing the request.
 */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, client: Redis = redis()): Promise<T> {
  try {
    const hit = await client.get(key);
    if (hit !== null) return JSON.parse(hit, revive) as T;
  } catch (error) {
    logger.warn("cache read failed", { key, error });
  }
  const value = await loader();
  try {
    await client.set(key, JSON.stringify(value, replace), "EX", ttlSeconds);
  } catch (error) {
    logger.warn("cache write failed", { key, error });
  }
  return value;
}

/** Removes cache entries; call after the underlying data changes. */
export async function invalidate(keys: string[], client: Redis = redis()): Promise<void> {
  if (keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch (error) {
    logger.warn("cache invalidate failed", { keys, error });
  }
}

/** Cache key builders, one place for all key shapes (prefix is added by the client). */
export const cacheKey = {
  folderSize: (nodeId: string) => `cache:folder-size:${nodeId}`,
  nodePath: (nodeId: string) => `cache:node-path:${nodeId}`,
  adminStats: () => "cache:admin-stats",
} as const;

// BigInt values (file sizes) survive the JSON round trip as tagged strings.
const BIGINT_TAG = "__bigint:";
function replace(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${BIGINT_TAG}${value.toString()}` : value;
}
function revive(_key: string, value: unknown): unknown {
  return typeof value === "string" && value.startsWith(BIGINT_TAG) ? BigInt(value.slice(BIGINT_TAG.length)) : value;
}

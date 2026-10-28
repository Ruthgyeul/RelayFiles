import "server-only";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { redis } from "./redis";

/**
 * Drops lapsed holders, then takes a slot when fewer than the limit are held. One script,
 * so two processes cannot both take the last slot.
 * KEYS[1] holders (sorted set: holder id → lease end). ARGV: now, lease end, limit, holder id, lease ms.
 */
const ACQUIRE_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[4])
redis.call("PEXPIRE", KEYS[1], ARGV[5])
return 1
`;

/** How many times per lease a held slot is renewed. */
const RENEWALS_PER_LEASE = 3;

export interface SemaphoreSlot {
  release(): Promise<void>;
}

/**
 * Takes one of `limit` slots named `name`, shared by every process using this Redis. Returns
 * null when all are taken. A held slot is renewed while it is held and lapses `leaseMs` after
 * the holder stops renewing (a crashed process), so slots are never lost for good.
 */
export async function acquireSlot(name: string, limit: number, leaseMs: number): Promise<SemaphoreSlot | null> {
  const key = `sem:${name}`;
  const holder = randomUUID();
  const now = Date.now();
  const taken = Number(await redis().eval(ACQUIRE_SCRIPT, 1, key, now, now + leaseMs, limit, holder, leaseMs));
  if (taken !== 1) return null;

  const renew = setInterval(() => {
    redis()
      .zadd(key, "XX", Date.now() + leaseMs, holder)
      .catch((error: unknown) => logger.warn("semaphore slot not renewed", { name, error }));
  }, leaseMs / RENEWALS_PER_LEASE);
  renew.unref();
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renew);
      await redis().zrem(key, holder);
    },
  };
}

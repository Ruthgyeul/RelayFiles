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

/**
 * Extends a holder's lease and the key's expiry (without that, the key of a lone holder
 * expired one lease after it was taken and the slot was gone). A holder whose entry is gone
 * (its lease lapsed and another acquire purged it, or Redis lost the key) takes a slot again
 * only when one is free, in the same script, so the limit still holds.
 * Returns 1 when renewed, 2 when taken again, 0 when the slot is lost.
 * KEYS[1] holders. ARGV: now, lease end, limit, holder id, lease ms.
 */
const RENEW_SCRIPT = `
local result = 1
if not redis.call("ZSCORE", KEYS[1], ARGV[4]) then
  redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
  if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
  result = 2
end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[4])
redis.call("PEXPIRE", KEYS[1], ARGV[5])
return result
`;

const RENEWED = { kept: 1, retaken: 2 } as const;

/** How many times per lease a held slot is renewed. */
const RENEWALS_PER_LEASE = 3;

/** The reason a slot's signal aborts with once the slot is lost. */
export class SlotLostError extends Error {
  constructor(name: string) {
    super(`semaphore slot "${name}" was lost`);
    this.name = "SlotLostError";
  }
}

export interface SemaphoreSlot {
  /**
   * Aborts (reason: {@link SlotLostError}) when a renewal finds the slot gone and every slot
   * taken by others. The holder must then stop the work the slot guards, or the limit is exceeded.
   */
  readonly signal: AbortSignal;
  release(): Promise<void>;
}

/**
 * Takes one of `limit` slots named `name`, shared by every process using this Redis. Returns
 * null when all are taken. A held slot is renewed while it is held and lapses `leaseMs` after
 * the holder stops renewing (a crashed process), so slots are never lost for good. A renewal
 * that finds the slot gone takes a free one again, or else stops renewing and aborts
 * `signal`. A renewal that cannot reach Redis is only logged: the lease may still be valid,
 * and the next renewal tries again.
 */
export async function acquireSlot(name: string, limit: number, leaseMs: number): Promise<SemaphoreSlot | null> {
  const key = `sem:${name}`;
  const holder = randomUUID();
  const now = Date.now();
  const taken = Number(await redis().eval(ACQUIRE_SCRIPT, 1, key, now, now + leaseMs, limit, holder, leaseMs));
  if (taken !== 1) return null;

  const lost = new AbortController();
  let released = false;
  const renewOnce = async () => {
    const at = Date.now();
    const result = Number(await redis().eval(RENEW_SCRIPT, 1, key, at, at + leaseMs, limit, holder, leaseMs));
    // A renewal that ran after release() took the slot again: give it back.
    if (released) {
      if (result !== 0) await redis().zrem(key, holder);
      return;
    }
    if (result === RENEWED.kept) return;
    if (result === RENEWED.retaken) {
      logger.warn("semaphore slot lapsed and was taken again", { name });
      return;
    }
    clearInterval(renew);
    logger.error("semaphore slot lost; stopping its holder", { name, limit });
    lost.abort(new SlotLostError(name));
  };
  const renew = setInterval(() => {
    renewOnce().catch((error: unknown) => logger.warn("semaphore slot not renewed", { name, error }));
  }, leaseMs / RENEWALS_PER_LEASE);
  renew.unref();
  return {
    signal: lost.signal,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renew);
      await redis().zrem(key, holder);
    },
  };
}

/** Slots of `name` held right now (lapsed holders not counted), for /metrics. */
export async function slotsHeld(name: string): Promise<number> {
  return redis().zcount(`sem:${name}`, Date.now(), "+inf");
}

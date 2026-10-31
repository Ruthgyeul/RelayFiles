import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ERRORS, type Lock, type Locker, type RequestRelease } from "@tus/server";
import type { Redis } from "ioredis";
import { UPLOAD } from "@/config/policy";
import { logger } from "../logger";
import { redis } from "../redis";

/** Deletes the lock only while this holder still owns it (a lapsed lock may belong to another). */
const UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`;

/** Extends the lease only while this holder still owns the lock. */
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end
return 0
`;

/** How many times per lease a held lock is renewed. */
const RENEWALS_PER_LEASE = 3;

const lockKey = (id: string) => `tus:lock:${id}`;
const releaseChannel = (id: string) => `tus:release:${id}`;

/**
 * Release requests for locks held by this process: one subscriber connection, one handler
 * per held lock. A request in another process that wants the lock publishes on its channel.
 */
class ReleaseRequests {
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, RequestRelease>();

  private connection(): Redis {
    if (!this.subscriber) {
      this.subscriber = redis().duplicate();
      this.subscriber.on("message", (channel: string) => {
        const handler = this.handlers.get(channel);
        if (handler) void Promise.resolve(handler()).catch((error: unknown) => logger.warn("tus lock release failed", { error }));
      });
    }
    return this.subscriber;
  }

  async listen(id: string, handler: RequestRelease): Promise<void> {
    this.handlers.set(releaseChannel(id), handler);
    await this.connection().subscribe(releaseChannel(id));
  }

  async stop(id: string): Promise<void> {
    this.handlers.delete(releaseChannel(id));
    await this.connection().unsubscribe(releaseChannel(id));
  }
}

/**
 * tus upload locks shared by every app process through Redis (the default MemoryLocker only
 * sees its own process, so two app replicas could write one upload at once). A lock is a key
 * with a lease that the holder renews; a waiting request asks the holder to let go (as tus
 * does in memory) and retries until UPLOAD.lockAcquireMs.
 */
export class RedisLocker implements Locker {
  private readonly releases = new ReleaseRequests();

  newLock(id: string): Lock {
    return new RedisLock(id, this.releases);
  }
}

class RedisLock implements Lock {
  private readonly holder = randomUUID();
  private renew: NodeJS.Timeout | null = null;

  constructor(
    private readonly id: string,
    private readonly releases: ReleaseRequests,
  ) {}

  async lock(stop: AbortSignal, requestRelease: RequestRelease): Promise<void> {
    const deadline = Date.now() + UPLOAD.lockAcquireMs;
    while (!stop.aborted && Date.now() < deadline) {
      if ((await redis().set(lockKey(this.id), this.holder, "PX", UPLOAD.lockLeaseMs, "NX")) === "OK") {
        await this.releases.listen(this.id, requestRelease);
        this.renew = setInterval(() => {
          redis()
            .eval(RENEW_SCRIPT, 1, lockKey(this.id), this.holder, UPLOAD.lockLeaseMs)
            .catch((error: unknown) => logger.warn("tus lock not renewed", { error }));
        }, UPLOAD.lockLeaseMs / RENEWALS_PER_LEASE);
        this.renew.unref();
        return;
      }
      // Someone holds it: ask them to finish (tus cancels their request), then try again.
      await redis().publish(releaseChannel(this.id), "release");
      await sleep(UPLOAD.lockRetryMs);
    }
    throw ERRORS.ERR_LOCK_TIMEOUT;
  }

  async unlock(): Promise<void> {
    if (this.renew) clearInterval(this.renew);
    this.renew = null;
    await this.releases.stop(this.id);
    await redis().eval(UNLOCK_SCRIPT, 1, lockKey(this.id), this.holder);
  }
}

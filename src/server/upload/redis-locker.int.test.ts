import { randomUUID } from "node:crypto";
import { ERRORS, type Lock } from "@tus/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { redis } from "../redis";
import { RedisLocker } from "./redis-locker";

afterAll(() => redis().disconnect());

const never = () => new AbortController().signal;

describe("tus redis locker", () => {
  it("lets a second request in once the holder lets go when asked", async () => {
    const id = randomUUID();
    // Two lockers stand for two app processes sharing Redis.
    const [first, second] = [new RedisLocker().newLock(id), new RedisLocker().newLock(id)];
    const release: { first?: () => Promise<void> } = {};
    const asked = vi.fn(async () => {
      await release.first?.();
    });
    await first.lock(never(), asked);
    release.first = () => first.unlock();

    await second.lock(never(), async () => undefined);
    expect(asked).toHaveBeenCalled();
    expect(await redis().get(`tus:lock:${id}`)).not.toBeNull();
    await second.unlock();
    expect(await redis().get(`tus:lock:${id}`)).toBeNull();
  });

  it("gives up with the tus lock timeout when the request is aborted", async () => {
    const id = randomUUID();
    const holder: Lock = new RedisLocker().newLock(id);
    await holder.lock(never(), async () => undefined); // never lets go
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 600);
    await expect(new RedisLocker().newLock(id).lock(abort.signal, async () => undefined)).rejects.toBe(ERRORS.ERR_LOCK_TIMEOUT);
    await holder.unlock();
  });

  it("does not delete a lock that another holder took after its own lapsed", async () => {
    const id = randomUUID();
    const stale = new RedisLocker().newLock(id);
    await stale.lock(never(), async () => undefined);
    // The lease ran out and another process took the lock.
    await redis().set(`tus:lock:${id}`, "someone-else");
    await stale.unlock();
    expect(await redis().get(`tus:lock:${id}`)).toBe("someone-else");
    await redis().del(`tus:lock:${id}`);
  });
});

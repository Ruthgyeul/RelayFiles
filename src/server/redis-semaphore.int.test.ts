import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { redis } from "./redis";
import { acquireSlot, SlotLostError } from "./redis-semaphore";

afterAll(() => redis().disconnect());

const LEASE_MS = 60_000;
/** A lease short enough to lapse within a test; renewals run every third of it. */
const SHORT_LEASE_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("redis semaphore", () => {
  it("hands out at most `limit` slots and takes released ones back", async () => {
    const name = `test-${randomUUID()}`;
    const first = await acquireSlot(name, 2, LEASE_MS);
    const second = await acquireSlot(name, 2, LEASE_MS);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await acquireSlot(name, 2, LEASE_MS)).toBeNull();

    await first!.release();
    await first!.release(); // releasing twice frees only one slot
    const third = await acquireSlot(name, 2, LEASE_MS);
    expect(third).not.toBeNull();
    expect(await acquireSlot(name, 2, LEASE_MS)).toBeNull();
    await Promise.all([second!.release(), third!.release()]);
  });

  it("frees the slots of a holder that stopped renewing (a crashed process)", async () => {
    const name = `test-${randomUUID()}`;
    // A slot whose lease ended a second ago, as a crashed process leaves it.
    await redis().zadd(`sem:${name}`, Date.now() - 1_000, "crashed");
    const slot = await acquireSlot(name, 1, LEASE_MS);
    expect(slot).not.toBeNull();
    expect(await redis().zscore(`sem:${name}`, "crashed")).toBeNull();
    await slot!.release();
  });

  it("keeps the slot of a lone holder that runs for many leases", async () => {
    const name = `test-${randomUUID()}`;
    const slot = await acquireSlot(name, 1, SHORT_LEASE_MS);
    expect(slot).not.toBeNull();
    // Renewals also extend the key's expiry; without that the key went away after one lease.
    await sleep(SHORT_LEASE_MS * 4);
    expect(await redis().zcard(`sem:${name}`)).toBe(1);
    expect(await acquireSlot(name, 1, LEASE_MS)).toBeNull();
    expect(slot!.signal.aborted).toBe(false);
    await slot!.release();
    expect(await redis().zcard(`sem:${name}`)).toBe(0);
  });

  it("takes a lost slot again when one is free", async () => {
    const name = `test-${randomUUID()}`;
    const slot = await acquireSlot(name, 1, SHORT_LEASE_MS);
    // As if Redis lost the key (or the lease lapsed and another acquire purged it).
    await redis().del(`sem:${name}`);
    await expect.poll(() => redis().zcard(`sem:${name}`)).toBe(1);
    expect(slot!.signal.aborted).toBe(false);
    expect(await acquireSlot(name, 1, LEASE_MS)).toBeNull();
    await slot!.release();
  });

  it("stops the holder whose slot was taken by others instead of exceeding the limit", async () => {
    const name = `test-${randomUUID()}`;
    const slot = await acquireSlot(name, 1, SHORT_LEASE_MS);
    await redis().del(`sem:${name}`);
    const other = await acquireSlot(name, 1, LEASE_MS);
    expect(other).not.toBeNull();
    await expect.poll(() => slot!.signal.aborted).toBe(true);
    expect(slot!.signal.reason).toBeInstanceOf(SlotLostError);
    // It no longer renews: only the other holder is counted.
    await sleep(SHORT_LEASE_MS);
    expect(await redis().zcard(`sem:${name}`)).toBe(1);
    await Promise.all([slot!.release(), other!.release()]);
    expect(await redis().zcard(`sem:${name}`)).toBe(0);
  });
});

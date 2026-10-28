import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { redis } from "./redis";
import { acquireSlot } from "./redis-semaphore";

afterAll(() => redis().disconnect());

const LEASE_MS = 60_000;

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
});

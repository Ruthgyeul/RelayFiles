import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import { redis } from "../redis";
import { releaseUpload, reservedBytes, reserveUpload, type ReservationScope } from "./reservations";

afterAll(() => redis().disconnect());

const account = (): ReservationScope => ({ kind: "account", id: randomUUID() });
const volume = (): ReservationScope => ({ kind: "volume", id: randomUUID() });

describe("upload reservations", () => {
  it("reserves in every scope only when all of them have room", async () => {
    const [a, v] = [account(), volume()];
    expect(await reserveUpload("u1", 6, [{ scope: a, limit: 10n }, { scope: v, limit: 100n }])).toBeNull();
    const full = await reserveUpload("u2", 6, [{ scope: a, limit: 10n }, { scope: v, limit: 100n }]);
    expect(full?.scope).toBe(a);
    // The refused upload left nothing behind in the scope that had room.
    expect([await reservedBytes(a), await reservedBytes(v)]).toEqual([6n, 6n]);
    // Reserving the same upload again replaces its entry instead of adding to it.
    expect(await reserveUpload("u1", 6, [{ scope: a, limit: 10n }])).toBeNull();
    expect(await reservedBytes(a)).toBe(6n);

    await releaseUpload("u1", [a, v]);
    expect([await reservedBytes(a), await reservedBytes(v)]).toEqual([0n, 0n]);
  });

  it("ignores reservations that lapsed", async () => {
    const a = account();
    const past = Date.now() - getEnv("uploads").UPLOAD_TMP_TTL_HOURS * MS.hour - MS.second;
    expect(await reserveUpload("old", 8, [{ scope: a, limit: 10n }], past)).toBeNull();
    expect(await reservedBytes(a)).toBe(0n);
    expect(await reserveUpload("new", 8, [{ scope: a, limit: 10n }])).toBeNull();
    expect(await reservedBytes(a)).toBe(8n);
  });

  it("treats no limit as unlimited and a used-up budget as full", async () => {
    const a = account();
    expect(await reserveUpload("big", 1e12, [{ scope: a, limit: null }])).toBeNull();
    expect((await reserveUpload("any", 1, [{ scope: volume(), limit: -5n }]))?.limit).toBe(-5n);
  });
});

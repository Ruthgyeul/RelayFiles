import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES } from "@/config/policy";
import { trashApi } from "./trash-api";

/** Answers each bulk request with its ids counted as deleted, recording the batch sizes. */
function stubBulk(failAt?: number) {
  const sizes: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
      sizes.push(ids.length);
      if (sizes.length === failAt) return new Response(JSON.stringify({ success: false, error: "Server error", code: "INTERNAL" }), { status: 500, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ success: true, data: { restored: [], deleted: ids.length, missing: 0 } }), { headers: { "content-type": "application/json" } });
    }),
  );
  return sizes;
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `id${index}`);

afterEach(() => vi.unstubAllGlobals());

describe("trashApi.bulk", () => {
  it("sends one request for a short list", async () => {
    const sizes = stubBulk();
    expect((await trashApi.bulk("delete", ids(3))).deleted).toBe(3);
    expect(sizes).toEqual([3]);
  });

  it("splits a list longer than one batch and adds the results up", async () => {
    const sizes = stubBulk();
    const count = FILES.maxBatchItems * 2 + 1;
    expect((await trashApi.bulk("delete", ids(count))).deleted).toBe(count);
    expect(sizes).toEqual([FILES.maxBatchItems, FILES.maxBatchItems, 1]);
  });

  it("stops at a failing batch", async () => {
    const sizes = stubBulk(2);
    await expect(trashApi.bulk("restore", ids(FILES.maxBatchItems * 3))).rejects.toThrow();
    expect(sizes).toHaveLength(2);
  });
});

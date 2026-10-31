import { describe, expect, it } from "vitest";
import { applySent, cancellable, initialItems, itemPercent, itemsSummary, patchItem, pushSample, speedPoints, withCancelled, withDone, withStarted } from "./transfer-items";

describe("transfer items", () => {
  const items = initialItems([
    { name: "a.jpg", size: 100 },
    { name: "Trip/b.jpg", size: 50 },
    { name: "c.jpg", size: 0 },
  ]);

  it("starts every file queued, keyed by its slot", () => {
    expect(items.map((item) => [item.key, item.status, item.sent])).toEqual([
      [0, "queued", 0],
      [1, "queued", 0],
      [2, "queued", 0],
    ]);
  });

  it("patches one item and keeps the others' identity", () => {
    const next = patchItem(items, 1, { status: "active" });
    expect(next[1]!.status).toBe("active");
    expect(next[0]).toBe(items[0]);
  });

  it("applies byte counts only to active items, never backwards or past the size", () => {
    const active = patchItem(patchItem(items, 0, { status: "active", sent: 40 }), 1, { status: "done", sent: 50 });
    const next = applySent(active, new Map([[0, 30], [1, 10]]), 0);
    expect(next[0]!.sent).toBe(40);
    expect(next[1]!.sent).toBe(50);
    expect(applySent(active, new Map([[0, 500]]), 0)[0]!.sent).toBe(100);
  });

  it("samples the speed of a running file about once a second", () => {
    const started = withStarted(items, 0, 1_000);
    const early = applySent(started, new Map([[0, 10]]), 1_500);
    expect(early[0]!.samples).toEqual([]);
    const sampled = applySent(early, new Map([[0, 60]]), 3_000);
    expect(sampled[0]!.samples).toEqual([30]);
    expect(sampled[0]!).toMatchObject({ sampledAt: 3_000, sampledSent: 60 });
  });

  it("knows what can be cancelled and how far each file is", () => {
    expect(cancellable({ status: "queued" })).toBe(true);
    expect(cancellable({ status: "active" })).toBe(true);
    expect(cancellable({ status: "done" })).toBe(false);
    expect(itemPercent({ status: "active", sent: 25, size: 100 })).toBe(25);
    expect(itemPercent({ status: "done", sent: 0, size: 0 })).toBe(100);
    expect(itemPercent({ status: "queued", sent: 0, size: 0 })).toBe(0);
  });

  it("summarizes the list", () => {
    const next = patchItem(patchItem(patchItem(items, 0, { status: "done" }), 1, { status: "cancelled" }), 2, { status: "failed" });
    expect(itemsSummary(next)).toBe("1 of 2 files · 1 cancelled · 1 failed");
    expect(itemsSummary(items)).toBe("0 of 3 files");
  });

  it("scales speed samples for the sparkline and keeps the newest", () => {
    expect(speedPoints([0, 50, 100]).map((point) => point.value)).toEqual([0, 50, 100]);
    expect(speedPoints([0, 0]).map((point) => point.value)).toEqual([0, 0]);
    expect(pushSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it("takes a cancelled file out of the totals once", () => {
    const transfer = { items, total: 150, files: 3 };
    const once = withCancelled(transfer, 1);
    expect(once).toMatchObject({ total: 100, files: 2 });
    expect(once.items![1]!.status).toBe("cancelled");
    expect(withCancelled(once, 1)).toBe(once);
    expect(withCancelled({ ...transfer, items: withDone(items, 0) }, 0).total).toBe(150);
  });
});

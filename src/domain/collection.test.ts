import { describe, expect, it } from "vitest";
import { collectionItemIndex, collectionItemOpen, collectionNameFor, type CollectionGuardRow } from "./collection";

const row = (id: string, data: Partial<CollectionGuardRow> = {}): CollectionGuardRow => ({ id, hasPassword: false, expAt: null, burn: false, downloads: 0, ...data });
const NOW = 1_000_000;

describe("collectionItemIndex", () => {
  it("finds the lowest item of the collection on the chain", () => {
    const chain = [row("root"), row("photos"), row("trip"), row("a")];
    expect(collectionItemIndex(chain, new Set(["a", "trip"]))).toBe(3);
    expect(collectionItemIndex(chain, new Set(["trip"]))).toBe(2);
    expect(collectionItemIndex(chain, new Set(["a"]))).toBe(3);
    expect(collectionItemIndex(chain, new Set(["other"]))).toBe(-1);
  });
});

describe("collectionItemOpen", () => {
  it("shows an item with nothing closed on its way", () => {
    expect(collectionItemOpen([row("root"), row("photos", { expAt: NOW + 1, downloads: 3 })], NOW)).toBe(true);
  });
  it("leaves out items behind a password, expired, or under a used delete-after-download item", () => {
    expect(collectionItemOpen([row("root"), row("photos", { hasPassword: true }), row("a")], NOW)).toBe(false);
    expect(collectionItemOpen([row("root"), row("a", { expAt: NOW })], NOW)).toBe(false);
    expect(collectionItemOpen([row("root", { burn: true, downloads: 1 }), row("a")], NOW)).toBe(false);
    expect(collectionItemOpen([row("root"), row("a", { burn: true })], NOW)).toBe(true);
  });
});

describe("collectionNameFor", () => {
  it("names a collection after its items", () => {
    expect(collectionNameFor(["Trip"])).toBe("Trip");
    expect(collectionNameFor(["Trip", "a.jpg", "b.jpg"])).toBe("Trip + 2 more");
    expect(collectionNameFor([])).toBe("Shared items");
  });
});

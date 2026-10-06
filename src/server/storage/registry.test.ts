import { describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { availableAboveReserve, driverFor, pickVolumeForNewAccount } = await import("./registry");

describe("pickVolumeForNewAccount", () => {
  it("picks the active volume with the most free space", () => {
    expect(
      pickVolumeForNewAccount([
        { id: "a", status: "ACTIVE", available: 100n },
        { id: "b", status: "ACTIVE", available: 500n },
        { id: "c", status: "DRAINING", available: 900n },
        { id: "d", status: "READONLY", available: 800n },
      ]),
    ).toBe("b");
  });

  it("returns null when no volume can take new accounts", () => {
    expect(pickVolumeForNewAccount([{ id: "a", status: "ACTIVE", available: 0n }])).toBeNull();
    expect(pickVolumeForNewAccount([])).toBeNull();
  });
});

describe("availableAboveReserve", () => {
  it("keeps the reserve percentage free", () => {
    expect(availableAboveReserve(1000n, 300n, 5)).toBe(250n);
    expect(availableAboveReserve(1000n, 40n, 5)).toBe(0n);
    expect(availableAboveReserve(2_000_000_000_000n, 1_000_000_000_000n, 5)).toBe(900_000_000_000n);
  });
});

describe("driverFor", () => {
  it("refuses offline volumes and reuses drivers", () => {
    expect(() => driverFor({ id: "x", driver: "LOCAL", mountPath: "/tmp/x", status: "OFFLINE" })).toThrow();
    const volume = { id: "y", driver: "LOCAL" as const, mountPath: "/tmp/y", status: "ACTIVE" as const };
    expect(driverFor(volume)).toBe(driverFor(volume));
  });
});

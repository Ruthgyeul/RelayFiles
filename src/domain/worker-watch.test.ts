import { describe, expect, it } from "vitest";
import { isWorkerState, workerChange } from "./worker-watch";

describe("workerChange", () => {
  it("alerts once when the heartbeat stops and once when it is back", () => {
    expect(workerChange("up", false)).toBe("down");
    expect(workerChange("down", false)).toBeNull();
    expect(workerChange("down", true)).toBe("back");
    expect(workerChange("up", true)).toBeNull();
  });

  it("treats a worker never seen before as up", () => {
    expect(workerChange(null, false)).toBe("down");
    expect(workerChange(null, true)).toBeNull();
  });

  it("reads only the stored states", () => {
    expect(isWorkerState("up")).toBe(true);
    expect(isWorkerState("down")).toBe(true);
    expect(isWorkerState("UP")).toBe(false);
    expect(isWorkerState(null)).toBe(false);
  });
});

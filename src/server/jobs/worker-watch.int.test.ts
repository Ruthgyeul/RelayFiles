import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordSample } from "../metrics/history";
import { redis } from "../redis";
import { deliverNotification } from "./notify-deliver";
import { checkWorker } from "./worker-watch";

vi.mock("./notify-deliver", () => ({ deliverNotification: vi.fn() }));
const deliver = vi.mocked(deliverNotification);

const HEARTBEAT_KEY = "jobs:heartbeat";
const STATE_KEY = "watch:worker";

beforeEach(async () => {
  deliver.mockReset();
  deliver.mockResolvedValue("sent");
  await redis().del(HEARTBEAT_KEY, STATE_KEY);
});

afterAll(async () => {
  await redis().del(HEARTBEAT_KEY, STATE_KEY);
  redis().disconnect();
});

describe("worker watch", () => {
  it("alerts once when the heartbeat stops and once when it is back", async () => {
    await redis().set(STATE_KEY, "up");
    expect(await checkWorker()).toBe("down");
    expect(await checkWorker()).toBeNull();
    await recordSample({ outPerSec: 0, disks: [] }, new Date());
    expect(await checkWorker()).toBe("back");
    expect(await checkWorker()).toBeNull();
    expect(deliver.mock.calls.map(([event]) => event.kind)).toEqual(["worker-down", "worker-back"]);
  });

  it("tries the alert again on the next check when it could not be delivered", async () => {
    await redis().set(STATE_KEY, "up");
    deliver.mockRejectedValueOnce(new Error("receiver unreachable"));
    await expect(checkWorker()).rejects.toThrow("receiver unreachable");
    expect(await redis().get(STATE_KEY)).toBe("up");
    expect(await checkWorker()).toBe("down");
    expect(await redis().get(STATE_KEY)).toBe("down");
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});

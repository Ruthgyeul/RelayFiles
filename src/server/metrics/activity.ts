import "server-only";
import { METRICS } from "@/config/policy";
import { redis } from "../redis";

/** Short-lived activity markers for the Server page ("ACTIVE STREAMS", "TRANSFERS"). */
export type ActivityKind = "stream" | "upload";
const keyOf = (kind: ActivityKind) => `activity:${kind}`;
const WINDOW_MS = METRICS.activeWindowSec * 1_000;

/** Marks one stream or upload as active now. Never fails the request it is called from. */
export async function markActive(kind: ActivityKind, id: string, now = Date.now()): Promise<void> {
  try {
    await redis()
      .multi()
      .zadd(keyOf(kind), now, id)
      .zremrangebyscore(keyOf(kind), 0, now - WINDOW_MS)
      .pexpire(keyOf(kind), WINDOW_MS)
      .exec();
  } catch {
    // Metrics only.
  }
}

/** Streams or uploads used within the last minute. */
export async function activeCount(kind: ActivityKind, now = Date.now()): Promise<number> {
  try {
    return await redis().zcount(keyOf(kind), now - WINDOW_MS, "+inf");
  } catch {
    return 0;
  }
}

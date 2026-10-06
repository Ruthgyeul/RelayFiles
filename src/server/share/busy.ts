import "server-only";
import { randomUUID } from "node:crypto";
import { SHARE } from "@/config/policy";
import { busyOf, type Busy } from "@/domain/share";
import { redis } from "../redis";

/** Recent public downloads per node: a sorted set of timestamps (plan §13.6). */
const keyOf = (nodeId: string) => `dl:${nodeId}`;
const LIMITS = { windowMs: SHARE.busyWindowMs, throttleAt: SHARE.busyThrottleAt, pauseAt: SHARE.busyPauseAt };

/** Records one download for a file and the folders it was reached through. */
export async function recordDownload(nodeIds: readonly string[], now: number): Promise<void> {
  const multi = redis().multi();
  for (const nodeId of new Set(nodeIds)) {
    multi.zadd(keyOf(nodeId), now, `${now}:${randomUUID()}`);
    multi.zremrangebyscore(keyOf(nodeId), 0, now - SHARE.busyWindowMs);
    multi.pexpire(keyOf(nodeId), SHARE.busyWindowMs);
  }
  await multi.exec();
}

/** Busy level of each node (`dlPaused` = paused by an admin). Redis errors count as idle. */
export async function busyLevels(nodes: readonly { id: string; dlPaused: boolean }[], now: number): Promise<Map<string, Busy>> {
  const result = new Map<string, Busy>();
  if (nodes.length === 0) return result;
  let times: (string[] | null)[] = [];
  try {
    const pipeline = redis().pipeline();
    for (const node of nodes) pipeline.zrangebyscore(keyOf(node.id), now - SHARE.busyWindowMs, "+inf", "WITHSCORES");
    times = ((await pipeline.exec()) ?? []).map(([error, value]) => (error ? null : (value as string[])));
  } catch {
    times = [];
  }
  nodes.forEach((node, index) => {
    const flat = times[index] ?? [];
    const scores = flat.filter((_, at) => at % 2 === 1).map(Number);
    result.set(node.id, busyOf(scores, node.dlPaused, now, LIMITS));
  });
  return result;
}

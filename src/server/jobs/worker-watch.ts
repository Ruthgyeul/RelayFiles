import "server-only";
import { getEnv } from "@/config/env";
import { METRICS, MS } from "@/config/policy";
import { isWorkerState, workerChange, type WorkerChange, type WorkerState } from "@/domain/worker-watch";
import { logger } from "../logger";
import { workerAlive } from "../metrics/history";
import { redis } from "../redis";
import { deliverNotification } from "./notify-deliver";

/** What the app last saw of the worker, shared by every app process. */
const STATE_KEY = "watch:worker";

/** How long a stopped worker has been silent when its heartbeat expires (the heartbeat's lifetime). */
function heartbeatLifetimeMs(): number {
  return getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC * METRICS.heartbeatMisses * MS.second;
}

/**
 * One check: reads the heartbeat, swaps the stored state in one command (SET … GET), and alerts
 * when the state changed. With several app processes only the one whose swap saw the old state
 * sends the alert. When the alert cannot be delivered, the old state is put back, so the next
 * check sees the same change and tries again. Returns the change, if any.
 */
export async function checkWorker(now: Date = new Date()): Promise<WorkerChange | null> {
  const alive = await workerAlive();
  const state: WorkerState = alive ? "up" : "down";
  const previous = await redis().set(STATE_KEY, state, "GET");
  const change = workerChange(isWorkerState(previous) ? previous : null, alive);
  if (!change) return null;
  if (change === "down") logger.error("worker stopped sending heartbeats");
  if (change === "back") logger.info("worker sends heartbeats again");
  const silentMinutes = Math.ceil(heartbeatLifetimeMs() / MS.minute);
  try {
    await deliverNotification(change === "down" ? { kind: "worker-down", silentMinutes } : { kind: "worker-back" }, now);
  } catch (error) {
    await (isWorkerState(previous) ? redis().set(STATE_KEY, previous) : redis().del(STATE_KEY));
    throw error;
  }
  return change;
}

/**
 * Checks the worker every METRICS_SAMPLE_INTERVAL_SEC from the app server (src/instrumentation.ts),
 * starting one heartbeat lifetime after the app starts: a release restarts both, and the worker
 * gets that long to send its first heartbeat. The timer never keeps the process alive.
 */
export function startWorkerWatch(): void {
  const every = getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC * MS.second;
  const tick = () => {
    checkWorker().catch((error: unknown) => logger.warn("worker check failed", { error }));
  };
  setTimeout(() => {
    tick();
    setInterval(tick, every).unref();
  }, heartbeatLifetimeMs()).unref();
}

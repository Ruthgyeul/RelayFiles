/**
 * The app's watch on the background worker: the worker refreshes a heartbeat while it runs, and
 * the app alerts once when it stops and once when it is back (docs/runbook.md "워커 감시").
 */

/** What the app last saw of the worker (kept in Redis, so every app process agrees). */
export type WorkerState = "up" | "down";

/** The alert a check calls for: "down" when the worker just stopped, "back" when it runs again. */
export type WorkerChange = "down" | "back";

export const isWorkerState = (value: unknown): value is WorkerState => value === "up" || value === "down";

/**
 * Compares a check with the state before it. A worker that was never seen counts as up, so a
 * missing heartbeat on the very first check still alerts, and a worker seen running for the
 * first time does not.
 */
export function workerChange(previous: WorkerState | null, alive: boolean): WorkerChange | null {
  if (alive) return previous === "down" ? "back" : null;
  return previous === "down" ? null : "down";
}

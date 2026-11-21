/**
 * Runs once when a Next.js server starts (Next.js instrumentation). The production app server
 * watches the background worker's heartbeat, since a stopped worker cannot report itself
 * (src/server/jobs/worker-watch.ts). Nothing starts during `next build` or `next dev`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { PHASE_PRODUCTION_BUILD } = await import("next/constants");
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { startWorkerWatch } = await import("./server/jobs/worker-watch");
  startWorkerWatch();
}

/**
 * Health check of the background worker (Docker Compose healthcheck, k3s livenessProbe):
 * npm run worker:health. Exits 1 when the worker heartbeat has expired, i.e. no worker with the
 * maintenance role has sampled for METRICS_SAMPLE_INTERVAL_SEC × the allowed misses. A worker
 * without that role (a media-only worker) has no heartbeat to check and always passes.
 */
import { runScript } from "./lib/bootstrap.mjs";

const { getEnv } = await import("../src/config/env");
const { workerAlive } = await import("../src/server/metrics/history");

await runScript(async () => {
  if (!getEnv("jobs").WORKER_ROLES.includes("maintenance")) return 0;
  if (await workerAlive()) return 0;
  console.error("No worker heartbeat (is the worker stuck or unable to reach Redis?).");
  return 1;
});

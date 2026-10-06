import { apiHandler, ok } from "@/server/http/api-handler";
import { checkHealth } from "@/server/services/health.service";

export const dynamic = "force-dynamic";

/** Liveness probe used by the Status page latency check (HEAD every 2.5 s): no backend work. */
export function HEAD() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Readiness: database, Redis and storage volume. 503 when the database is down. */
export const GET = apiHandler(async () => {
  const health = await checkHealth();
  return ok(health, { status: health.status === "down" ? 503 : 200, headers: { "cache-control": "no-store" } });
});

import { PROMETHEUS_CONTENT_TYPE } from "@/domain/prometheus";
import { fromAdminNetwork } from "@/server/auth/admin-network";
import { ApiError } from "@/server/http/api-error";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { prometheusMetrics } from "@/server/services/prometheus.service";

/**
 * Prometheus metrics for Grafana: an admin's personal API token with `metrics:read`
 * (`Authorization: Bearer`), from ADMIN_ALLOWED_CIDRS when it is set. No account, file or
 * client is named in any label.
 */
export const GET = apiV1Handler("metrics:read", async ({ req, caller }) => {
  if (!caller.account.isAdmin || !fromAdminNetwork(req.headers)) throw new ApiError("FORBIDDEN");
  return new Response(await prometheusMetrics(), { headers: { "content-type": PROMETHEUS_CONTENT_TYPE, "cache-control": "no-store" } });
});

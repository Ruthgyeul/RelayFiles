import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { recentAuditEvents } from "@/server/services/audit.service";

/** The newest admin audit entries (roles, deletions, sign-up mode, cleanups, invites, admin tokens). */
export const GET = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  return { events: await recentAuditEvents() };
});

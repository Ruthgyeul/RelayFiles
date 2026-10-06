import { incidentInputSchema } from "@/contracts/status";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { postIncident } from "@/server/services/status.service";

/** Posts an incident to the Status page. */
export const POST = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  return postIncident(incidentInputSchema.parse(await req.json()));
});

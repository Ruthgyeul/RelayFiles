import { incidentInputSchema } from "@/contracts/status";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { postIncident } from "@/server/services/status.service";

/** Posts an incident to the Status page. */
export const POST = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  const posted = await postIncident(incidentInputSchema.parse(await req.json()));
  await audit(admin, clientInfo(req.headers), "incident.post", { id: posted.id });
  return posted;
});

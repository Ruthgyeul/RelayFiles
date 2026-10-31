import { z } from "zod";
import { incidentInputSchema } from "@/contracts/status";
import { ID_PATTERN } from "@/domain/ids";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { editIncident, removeIncident } from "@/server/services/status.service";

const idSchema = z.string().regex(ID_PATTERN.node);

/** Edits an incident. */
export const PUT = apiHandler<{ saved: true }, { id: string }>({ auth: "admin" }, async ({ req, params, active: admin }) => {
  const id = idSchema.parse(params.id);
  await editIncident(id, incidentInputSchema.parse(await req.json()));
  await audit(admin, clientInfo(req.headers), "incident.edit", { id });
  return { saved: true };
});

/** Deletes an incident. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>({ auth: "admin" }, async ({ req, params, active: admin }) => {
  const id = idSchema.parse(params.id);
  await removeIncident(id);
  await audit(admin, clientInfo(req.headers), "incident.delete", { id });
  return { deleted: true };
});

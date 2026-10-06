import { z } from "zod";
import { incidentInputSchema } from "@/contracts/status";
import { ID_PATTERN } from "@/domain/ids";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { editIncident, removeIncident } from "@/server/services/status.service";

const idSchema = z.string().regex(ID_PATTERN.node);

/** Edits an incident. */
export const PUT = apiHandler<{ saved: true }, { id: string }>(async ({ req, params }) => {
  requireAdmin(await deviceOf(req));
  await editIncident(idSchema.parse(params.id), incidentInputSchema.parse(await req.json()));
  return { saved: true };
});

/** Deletes an incident. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>(async ({ req, params }) => {
  requireAdmin(await deviceOf(req));
  await removeIncident(idSchema.parse(params.id));
  return { deleted: true };
});

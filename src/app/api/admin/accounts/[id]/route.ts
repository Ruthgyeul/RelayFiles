import { z } from "zod";
import { manageSchema } from "@/contracts/admin";
import { ID_PATTERN } from "@/domain/ids";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { deleteAccountAsAdmin, manageAccount } from "@/server/services/admin.service";

const accountId = z.string().regex(ID_PATTERN.account);

/** Manage dialog: role, deletion date, storage limit. */
export const PATCH = apiHandler<{ updated: true }, { id: string }>(async ({ req, params }) => {
  requireAdmin(await deviceOf(req));
  await manageAccount(accountId.parse(params.id), manageSchema.parse(await req.json()), new Date());
  return { updated: true };
});

/** Deletes a member account with all of its files. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>(async ({ req, params }) => {
  requireAdmin(await deviceOf(req));
  await deleteAccountAsAdmin(accountId.parse(params.id));
  return { deleted: true };
});

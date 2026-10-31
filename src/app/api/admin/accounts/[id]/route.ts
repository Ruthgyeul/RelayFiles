import { z } from "zod";
import { manageSchema } from "@/contracts/admin";
import { ID_PATTERN } from "@/domain/ids";
import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { deleteAccountAsAdmin, manageAccount } from "@/server/services/admin.service";
import { audit } from "@/server/services/audit.service";

const accountId = z.string().regex(ID_PATTERN.account);

/** Manage dialog: role, deletion date, storage limit. */
export const PATCH = apiHandler<{ updated: true }, { id: string }>({ auth: "admin" }, async ({ req, params, active: admin }) => {
  requireRecentAuth(admin);
  const id = accountId.parse(params.id);
  const input = manageSchema.parse(await req.json());
  await manageAccount(id, input, new Date());
  const detail = `role ${input.isAdmin ? "admin" : "member"} · deletion ${input.days}${input.reset ? " (reset)" : ""} · quota ${input.quotaGb === null ? "unlimited" : `${input.quotaGb} GB`}`;
  await audit(admin, clientInfo(req.headers), "account.manage", { id, detail });
  return { updated: true };
});

/** Deletes a member account with all of its files. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>({ auth: "admin" }, async ({ req, params, active: admin }) => {
  requireRecentAuth(admin);
  const id = accountId.parse(params.id);
  const deleted = await deleteAccountAsAdmin(id);
  await audit(admin, clientInfo(req.headers), "account.delete", { id, detail: deleted.name });
  return { deleted: true };
});

import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import { maskInvite } from "@/domain/admin";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { revokeInviteCode } from "@/server/services/server-settings.service";

/** Revokes an unused invite code. */
export const DELETE = apiHandler<{ revoked: true }, { code: string }>({ auth: "admin" }, async ({ req, params, active: admin }) => {
  const code = z.string().regex(ID_PATTERN.invite).parse(params.code);
  await revokeInviteCode(code);
  await audit(admin, clientInfo(req.headers), "invite.revoke", { id: maskInvite(code) });
  return { revoked: true };
});

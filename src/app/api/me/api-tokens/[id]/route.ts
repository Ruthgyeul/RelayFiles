import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { revokeApiToken } from "@/server/services/api-token.service";
import { audit } from "@/server/services/audit.service";
import { logAccountEvent } from "@/server/services/security-log.service";

/** Revokes a token of the active account; it stops working at once. */
export const DELETE = apiHandler<{ revoked: true }, { id: string }>({ auth: "active" }, async ({ req, params, active }) => {
  const { name } = await revokeApiToken(active.account.id, params.id);
  const client = clientInfo(req.headers);
  await logAccountEvent(active.account.id, client, "apiToken.revoked", name);
  await audit(active, client, "apiToken.revoke", { id: params.id });
  return { revoked: true };
});

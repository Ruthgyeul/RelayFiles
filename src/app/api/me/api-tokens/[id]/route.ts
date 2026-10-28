import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { revokeApiToken } from "@/server/services/api-token.service";
import { audit } from "@/server/services/audit.service";

/** Revokes a token of the active account; it stops working at once. */
export const DELETE = apiHandler<{ revoked: true }, { id: string }>({ auth: "active" }, async ({ req, params, active }) => {
  await revokeApiToken(active.account.id, params.id);
  await audit(active, clientInfo(req.headers), "apiToken.revoke", { id: params.id });
  return { revoked: true };
});

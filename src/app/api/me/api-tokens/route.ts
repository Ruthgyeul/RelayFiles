import { createApiTokenSchema } from "@/contracts/api-tokens";
import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createApiToken, listApiTokens } from "@/server/services/api-token.service";
import { audit } from "@/server/services/audit.service";

/** The active account's personal API tokens (never the tokens themselves). */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => listApiTokens(account.id));

/** A new token, shown once. Like revealing the account token, it needs a recent token entry. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active }) => {
  requireRecentAuth(active);
  const created = await createApiToken(active.account, createApiTokenSchema.parse(await req.json()));
  await audit(active, clientInfo(req.headers), "apiToken.create", { id: created.item.id, detail: `${created.item.name} (${created.item.scopes.join(", ")})` });
  return ok(created, { status: 201, headers: { "cache-control": "no-store" } });
});

import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { revealToken } from "@/server/services/auth.service";

/** Full token of the active account, for "Save token" and the profile's "Show" button. */
export const GET = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return ok({ token: await revealToken(account.id) }, { headers: { "cache-control": "no-store" } });
});

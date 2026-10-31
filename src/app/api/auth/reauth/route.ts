import { tokenSignInSchema } from "@/contracts/auth";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { reauthenticate } from "@/server/services/auth.service";

/** "Confirm it's you": the active account's token, entered again before a token or account action. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { sessionId, account } }) => {
  const { token } = tokenSignInSchema.parse(await req.json());
  await reauthenticate(sessionId, account.id, token, clientInfo(req.headers));
  return { confirmed: true };
});

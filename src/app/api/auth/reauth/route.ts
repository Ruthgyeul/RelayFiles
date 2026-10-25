import { tokenSignInSchema } from "@/contracts/auth";
import { clientInfo } from "@/server/auth/client-info";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { reauthenticate } from "@/server/services/auth.service";

/** "Confirm it's you": the active account's token, entered again before an admin action. */
export const POST = apiHandler(async ({ req }) => {
  const { token } = tokenSignInSchema.parse(await req.json());
  const { sessionId, account } = requireActive(await deviceOf(req));
  await reauthenticate(sessionId, account.id, token, clientInfo(req.headers));
  return { confirmed: true };
});

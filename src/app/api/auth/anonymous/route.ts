import type { CreatedAccount } from "@/contracts/auth";
import { createAccountSchema } from "@/contracts/auth";
import { clientInfo } from "@/server/auth/client-info";
import { deviceOf } from "@/server/auth/current";
import { toSessionAccount, toSessionState, withSession, writeSessionCookie } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createAnonymousAccount, signupMode } from "@/server/services/auth.service";

/** Creates an anonymous account, signs this device in and returns the token once. */
export const POST = apiHandler(async ({ req }) => {
  const input = createAccountSchema.parse(await req.json().catch(() => ({})));
  const device = await deviceOf(req);
  const created = await createAnonymousAccount(input, clientInfo(req.headers));
  const active = { sessionId: created.sessionId, account: created.account };
  const accounts = [...device.accounts, active];
  const body: CreatedAccount = {
    account: toSessionAccount(created.account),
    token: created.token,
    session: await toSessionState({ accounts, active }, await signupMode()),
  };
  const response = ok(body, { status: 201 });
  writeSessionCookie(response, withSession(device.cookie, created.sessionId));
  return response;
});

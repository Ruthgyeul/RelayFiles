import { accountRefSchema } from "@/contracts/auth";
import { deviceOf } from "@/server/auth/current";
import { toSessionState, writeSessionCookie } from "@/server/auth/device-session";
import { ApiError } from "@/server/http/api-error";
import { apiHandler, ok } from "@/server/http/api-handler";
import { signupMode } from "@/server/services/auth.service";

/** Makes another account that is signed in on this device the active one. */
export const POST = apiHandler(async ({ req }) => {
  const { accountId } = accountRefSchema.parse(await req.json());
  const device = await deviceOf(req);
  const target = device.accounts.find((item) => item.account.id === accountId);
  if (!target) throw new ApiError("NOT_FOUND");
  const response = ok(toSessionState({ accounts: device.accounts, active: target }, await signupMode()));
  writeSessionCookie(response, { sessionIds: device.cookie.sessionIds, activeSessionId: target.sessionId });
  return response;
});

import { signOutSchema } from "@/contracts/auth";
import { deviceOf } from "@/server/auth/current";
import { toSessionState, withoutSession, writeSessionCookie } from "@/server/auth/device-session";
import { ApiError } from "@/server/http/api-error";
import { apiHandler, ok } from "@/server/http/api-handler";
import { signOut, signupMode } from "@/server/services/auth.service";

/** Signs one account (default: the active one) out of this device. */
export const POST = apiHandler(async ({ req }) => {
  const { accountId } = signOutSchema.parse(await req.json().catch(() => ({})));
  const device = await deviceOf(req);
  const target = accountId ? device.accounts.find((item) => item.account.id === accountId) : device.active;
  if (!target) throw new ApiError(accountId ? "NOT_FOUND" : "UNAUTHORIZED");
  await signOut(target.sessionId);
  const cookie = withoutSession(device.cookie, target.sessionId);
  const accounts = device.accounts.filter((item) => item.sessionId !== target.sessionId);
  const active = accounts.find((item) => item.sessionId === cookie.activeSessionId) ?? null;
  const response = ok(toSessionState({ accounts, active }, await signupMode()));
  writeSessionCookie(response, cookie);
  return response;
});

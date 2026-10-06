import { deviceOf } from "@/server/auth/current";
import { requireActive, toSessionState, withoutSession, writeSessionCookie } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { signupMode } from "@/server/services/auth.service";
import { deleteAccount } from "@/server/services/profile.service";

/** Deletes the active account, its token and all of its files, and signs it out of this device. */
export const DELETE = apiHandler(async ({ req }) => {
  const device = await deviceOf(req);
  const target = requireActive(device);
  await deleteAccount(target.account);
  const cookie = withoutSession(device.cookie, target.sessionId);
  const accounts = device.accounts.filter((item) => item.sessionId !== target.sessionId);
  const active = accounts.find((item) => item.sessionId === cookie.activeSessionId) ?? null;
  const response = ok(await toSessionState({ accounts, active }, await signupMode()));
  writeSessionCookie(response, cookie);
  return response;
});

import { deviceOf } from "@/server/auth/current";
import { clientInfo } from "@/server/auth/client-info";
import { requireActive, requireRecentAuth, toSessionState, withoutSession, writeSessionCookie } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { signupMode } from "@/server/services/auth.service";
import { deleteOwnAccount } from "@/server/services/profile.service";

/**
 * Deletes the active account, its token and all of its files, and signs it out of this device.
 * Admins must have entered their token recently, and an admin's own deletion is audited like
 * the one from the Accounts page.
 */
export const DELETE = apiHandler(async ({ req }) => {
  const device = await deviceOf(req);
  const target = requireActive(device);
  requireRecentAuth(target);
  await deleteOwnAccount(target.account);
  if (target.account.isAdmin) await audit(target, clientInfo(req.headers), "account.delete", { id: target.account.id, detail: `${target.account.name} (own account)` });
  const cookie = withoutSession(device.cookie, target.sessionId);
  const accounts = device.accounts.filter((item) => item.sessionId !== target.sessionId);
  const active = accounts.find((item) => item.sessionId === cookie.activeSessionId) ?? null;
  const response = ok(await toSessionState({ accounts, active }, await signupMode()));
  writeSessionCookie(response, cookie);
  return response;
});

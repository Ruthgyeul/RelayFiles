import { signedOutDetail } from "@/domain/security-log";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { listDevices, signOutOtherDevices } from "@/server/services/profile.service";
import { logAccountEvent } from "@/server/services/security-log.service";

/** Devices signed in to the active account (this one first). */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account, sessionId } }) => {
  return listDevices(account.id, sessionId);
});

/** "Sign out all others": every device except this one. */
export const DELETE = apiHandler({ auth: "active" }, async ({ req, active: { account, sessionId } }) => {
  const result = await signOutOtherDevices(account.id, sessionId);
  if (result.signedOut > 0) await logAccountEvent(account.id, clientInfo(req.headers), "devices.signout", signedOutDetail(result.signedOut));
  return result;
});

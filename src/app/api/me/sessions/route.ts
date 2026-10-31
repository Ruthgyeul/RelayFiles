import { apiHandler } from "@/server/http/api-handler";
import { listDevices, signOutOtherDevices } from "@/server/services/profile.service";

/** Devices signed in to the active account (this one first). */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account, sessionId } }) => {
  return listDevices(account.id, sessionId);
});

/** "Sign out all others": every device except this one. */
export const DELETE = apiHandler({ auth: "active" }, async ({ active: { account, sessionId } }) => {
  return signOutOtherDevices(account.id, sessionId);
});

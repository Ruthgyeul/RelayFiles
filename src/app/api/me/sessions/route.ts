import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { listDevices, signOutOtherDevices } from "@/server/services/profile.service";

/** Devices signed in to the active account (this one first). */
export const GET = apiHandler(async ({ req }) => {
  const { account, sessionId } = requireActive(await deviceOf(req));
  return listDevices(account.id, sessionId);
});

/** "Sign out all others": every device except this one. */
export const DELETE = apiHandler(async ({ req }) => {
  const { account, sessionId } = requireActive(await deviceOf(req));
  return signOutOtherDevices(account.id, sessionId);
});

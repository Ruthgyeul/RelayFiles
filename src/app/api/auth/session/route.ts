import { deviceOf } from "@/server/auth/current";
import { toSessionState, writeSessionCookie } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { signupMode } from "@/server/services/auth.service";

/** Accounts signed in on this device, the active one, and the server's sign-up mode. */
export const GET = apiHandler(async ({ req }) => {
  const device = await deviceOf(req);
  const response = ok(toSessionState(device, await signupMode()));
  if (device.stale) writeSessionCookie(response, device.cookie);
  return response;
});

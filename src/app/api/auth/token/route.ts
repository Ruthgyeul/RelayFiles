import { tokenSignInSchema } from "@/contracts/auth";
import { clientInfo } from "@/server/auth/client-info";
import { deviceOf } from "@/server/auth/current";
import { toSessionState, withSession, writeSessionCookie } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { signInWithToken, signupMode } from "@/server/services/auth.service";

/** Signs this device in with an account token and makes that account active. */
export const POST = apiHandler(async ({ req }) => {
  const { token } = tokenSignInSchema.parse(await req.json());
  const device = await deviceOf(req);
  const signedIn = await signInWithToken(
    token,
    clientInfo(req.headers),
    device.accounts.map((item) => item.account.id),
  );
  const accounts = [...device.accounts, signedIn];
  const response = ok(toSessionState({ accounts, active: signedIn }, await signupMode()));
  writeSessionCookie(response, withSession(device.cookie, signedIn.sessionId));
  return response;
});

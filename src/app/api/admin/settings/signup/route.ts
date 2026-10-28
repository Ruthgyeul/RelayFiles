import { signupModeSchema } from "@/contracts/server-settings";
import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { setSignupMode } from "@/server/services/server-settings.service";

/** "New accounts": open, invite only or closed. */
export const PUT = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  requireRecentAuth(admin);
  const { mode } = signupModeSchema.parse(await req.json());
  await setSignupMode(mode);
  await audit(admin, clientInfo(req.headers), "signup.mode", { detail: mode });
  return { mode };
});

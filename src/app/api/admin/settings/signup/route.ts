import { signupModeSchema } from "@/contracts/server-settings";
import { deviceOf } from "@/server/auth/current";
import { clientInfo } from "@/server/auth/client-info";
import { requireAdmin, requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { setSignupMode } from "@/server/services/server-settings.service";

/** "New accounts": open, invite only or closed. */
export const PUT = apiHandler(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  requireRecentAuth(admin);
  const { mode } = signupModeSchema.parse(await req.json());
  await setSignupMode(mode);
  await audit(admin, clientInfo(req.headers), "signup.mode", { detail: mode });
  return { mode };
});

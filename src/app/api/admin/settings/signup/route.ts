import { signupModeSchema } from "@/contracts/server-settings";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { setSignupMode } from "@/server/services/server-settings.service";

/** "New accounts": open, invite only or closed. */
export const PUT = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  const { mode } = signupModeSchema.parse(await req.json());
  await setSignupMode(mode);
  return { mode };
});

import { maskInvite } from "@/domain/admin";
import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { generateInvite } from "@/server/services/server-settings.service";

/** A new one-time invite code (it lets someone in while sign-ups are invite-only, so the token is asked again). */
export const POST = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  requireRecentAuth(admin);
  const code = await generateInvite();
  await audit(admin, clientInfo(req.headers), "invite.create", { id: maskInvite(code) });
  return { code };
});

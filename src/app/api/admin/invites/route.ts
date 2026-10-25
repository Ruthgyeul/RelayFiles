import { deviceOf } from "@/server/auth/current";
import { maskInvite } from "@/domain/admin";
import { clientInfo } from "@/server/auth/client-info";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { generateInvite } from "@/server/services/server-settings.service";

/** A new one-time invite code. */
export const POST = apiHandler(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  const code = await generateInvite();
  await audit(admin, clientInfo(req.headers), "invite.create", { id: maskInvite(code) });
  return { code };
});

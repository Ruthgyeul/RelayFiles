import { createInviteSchema } from "@/contracts/server-settings";
import { maskInvite } from "@/domain/admin";
import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { generateInvite } from "@/server/services/server-settings.service";

/**
 * A new invite code `{ maxUses?, expiresInDays? }` (defaults: one account, INVITE.defaultExpiryDays).
 * It lets people in while sign-ups are invite-only, so the token is asked again.
 */
export const POST = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  requireRecentAuth(admin);
  const limits = createInviteSchema.parse(req.headers.get("content-length") === "0" || !req.body ? {} : await req.json());
  const code = await generateInvite(limits);
  const expiry = limits.expiresInDays === null ? "no expiry" : `${limits.expiresInDays} d`;
  await audit(admin, clientInfo(req.headers), "invite.create", { id: maskInvite(code), detail: `${limits.maxUses} ${limits.maxUses === 1 ? "use" : "uses"}, ${expiry}` });
  return { code };
});

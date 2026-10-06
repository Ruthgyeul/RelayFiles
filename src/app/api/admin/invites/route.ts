import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { generateInvite } from "@/server/services/server-settings.service";

/** A new one-time invite code. */
export const POST = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  return { code: await generateInvite() };
});

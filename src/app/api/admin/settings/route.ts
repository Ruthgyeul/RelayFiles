import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serverSettings } from "@/server/services/server-settings.service";

/** Sign-up mode, theme, announcement and invite codes for the Server page. */
export const GET = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  return serverSettings();
});

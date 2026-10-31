import { apiHandler } from "@/server/http/api-handler";
import { serverSettings } from "@/server/services/server-settings.service";

/** Sign-up mode, theme, announcement and invite codes for the Server page. */
export const GET = apiHandler({ auth: "admin" }, async () => {
  return serverSettings();
});

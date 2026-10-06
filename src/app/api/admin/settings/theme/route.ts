import { themeSchema } from "@/contracts/server-settings";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { setTheme } from "@/server/services/server-settings.service";

/** The color theme every page is rendered with. */
export const PUT = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  const { theme } = themeSchema.parse(await req.json());
  await setTheme(theme);
  return { theme };
});

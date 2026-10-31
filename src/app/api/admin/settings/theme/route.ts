import { themeSchema } from "@/contracts/server-settings";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { setTheme } from "@/server/services/server-settings.service";

/** The color theme every page is rendered with. */
export const PUT = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  const { theme } = themeSchema.parse(await req.json());
  await setTheme(theme);
  await audit(admin, clientInfo(req.headers), "theme.set", { detail: theme });
  return { theme };
});

import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { runCleanup } from "@/server/services/admin.service";
import { audit } from "@/server/services/audit.service";

/** "Run cleanup now": deletes expired accounts and items immediately (after the token is entered again). */
export const POST = apiHandler({ auth: "admin" }, async ({ req, active: admin }) => {
  requireRecentAuth(admin);
  const result = await runCleanup(new Date());
  await audit(admin, clientInfo(req.headers), "cleanup.run", { detail: `${result.accounts} accounts · ${result.items} items` });
  return result;
});

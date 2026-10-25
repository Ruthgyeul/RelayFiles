import { deviceOf } from "@/server/auth/current";
import { clientInfo } from "@/server/auth/client-info";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { runCleanup } from "@/server/services/admin.service";
import { audit } from "@/server/services/audit.service";

/** "Run cleanup now": deletes expired accounts and items immediately. */
export const POST = apiHandler(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  const result = await runCleanup(new Date());
  await audit(admin, clientInfo(req.headers), "cleanup.run", { detail: `${result.accounts} accounts · ${result.items} items` });
  return result;
});

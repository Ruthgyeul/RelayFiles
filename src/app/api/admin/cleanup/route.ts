import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { runCleanup } from "@/server/services/admin.service";

/** "Run cleanup now": deletes expired accounts and items immediately. */
export const POST = apiHandler(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  return runCleanup(new Date());
});

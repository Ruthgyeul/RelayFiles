import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { listAccounts } from "@/server/services/admin.service";

/** Every account with usage, for the admin Accounts page. */
export const GET = apiHandler(async ({ req }) => {
  const device = await deviceOf(req);
  const admin = requireAdmin(device);
  return listAccounts(
    device.accounts.map((entry) => entry.account.id),
    admin.account.id,
  );
});

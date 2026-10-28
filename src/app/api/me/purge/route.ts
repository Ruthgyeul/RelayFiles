import { apiHandler } from "@/server/http/api-handler";
import { purgeExpired } from "@/server/services/profile.service";

/** "Purge now": deletes the active account's expired items immediately. */
export const POST = apiHandler({ auth: "active" }, async ({ active: { account } }) => {
  return purgeExpired(account, new Date());
});

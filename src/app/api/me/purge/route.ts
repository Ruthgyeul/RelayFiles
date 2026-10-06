import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { purgeExpired } from "@/server/services/profile.service";

/** "Purge now": deletes the active account's expired items immediately. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return purgeExpired(account, new Date());
});

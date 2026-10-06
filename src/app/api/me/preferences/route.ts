import { preferencesSchema } from "@/contracts/profile";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { savePreferences } from "@/server/services/profile.service";

/** Account preferences ("Strip metadata on public links"). */
export const PATCH = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return savePreferences(account.id, preferencesSchema.parse(await req.json()));
});

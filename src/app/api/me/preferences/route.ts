import { preferencesSchema } from "@/contracts/profile";
import { apiHandler } from "@/server/http/api-handler";
import { savePreferences } from "@/server/services/profile.service";

/** Account preferences ("Strip metadata on public links"). */
export const PATCH = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return savePreferences(account.id, preferencesSchema.parse(await req.json()));
});

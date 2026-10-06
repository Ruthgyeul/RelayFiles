import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { tagSuggestions } from "@/server/services/node.service";

/** Tags used in the active account with counts, most used first. */
export const GET = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return tagSuggestions(account.id);
});

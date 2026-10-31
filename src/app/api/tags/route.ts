import { apiHandler } from "@/server/http/api-handler";
import { tagSuggestions } from "@/server/services/node.service";

/** Tags used in the active account with counts, most used first. */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => {
  return tagSuggestions(account.id);
});

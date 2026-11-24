import { savedSearchCreateSchema } from "@/contracts/saved-searches";
import { apiHandler } from "@/server/http/api-handler";
import { savedSearches, saveSearch } from "@/server/services/saved-search.service";

/** The account's saved global searches, oldest first. */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => savedSearches(account.id));

/** Keeps a search (normalized); the same search again returns the one kept. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return saveSearch(account.id, savedSearchCreateSchema.parse(await req.json()).query);
});

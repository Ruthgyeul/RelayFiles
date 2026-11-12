import { apiHandler } from "@/server/http/api-handler";
import { sharedItems } from "@/server/services/shared-items.service";

/** "Shared by me": everything of the active account that can be opened from outside. */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => sharedItems(account.id));

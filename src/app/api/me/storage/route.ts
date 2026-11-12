import { apiHandler } from "@/server/http/api-handler";
import { storageOverview } from "@/server/services/storage-view.service";

/** Where the active account's space goes (Storage page). */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => storageOverview(account));

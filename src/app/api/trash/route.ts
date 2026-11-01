import type { DeletedItemDto } from "@/contracts/trash";
import { apiHandler } from "@/server/http/api-handler";
import { listRecentlyDeleted } from "@/server/services/trash.service";

/** "Recently deleted" of the active account, newest first. */
export const GET = apiHandler<DeletedItemDto[]>({ auth: "active" }, async ({ active: { account } }) => listRecentlyDeleted(account.id));

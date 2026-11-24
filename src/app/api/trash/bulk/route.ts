import { trashBulkSchema, type TrashBulkResult } from "@/contracts/trash";
import { apiHandler } from "@/server/http/api-handler";
import { bulkTrashAction } from "@/server/services/trash.service";

/** Restores or deletes forever several deleted items ("Restore all", "Empty", Undo after a delete). */
export const POST = apiHandler<TrashBulkResult>({ auth: "active" }, async ({ req, active: { account } }) => bulkTrashAction(account, trashBulkSchema.parse(await req.json())));

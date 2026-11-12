import { renameBatchSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { renameBatch } from "@/server/services/batch-rename.service";

/** Renames several items of one folder at once; all or nothing. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { items } = renameBatchSchema.parse(await req.json());
  return renameBatch(account, items);
});

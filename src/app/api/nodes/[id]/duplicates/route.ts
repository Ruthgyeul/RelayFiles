import { duplicatesQuerySchema, folderRefSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { findDuplicates } from "@/server/services/duplicates.service";

/** Files with the same content in a folder (and, with ?recursive=1, its subfolders). */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const { recursive } = duplicatesQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return findDuplicates(account, folderRefSchema.parse(params.id), recursive);
});

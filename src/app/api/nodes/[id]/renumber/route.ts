import { folderRefSchema, renumberApplySchema, renumberQuerySchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { applyRenumber, previewRenumber } from "@/server/services/renumber.service";

/** How the files directly inside a folder would be renamed to 01, 02, … (nothing changes). */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const { sort, order } = renumberQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return previewRenumber(account, folderRefSchema.parse(params.id), sort, order);
});

/** Renames the files as reviewed; 409 when the folder changed since the preview. */
export const POST = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return applyRenumber(account, folderRefSchema.parse(params.id), renumberApplySchema.parse(await req.json()));
});

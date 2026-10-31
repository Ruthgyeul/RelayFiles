import { idsQuerySchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { zipItems } from "@/server/services/zip.service";

/** Downloads files and folders of the active account as one zip: /api/zip?ids=a,b */
export const GET = apiHandler<Response>({ auth: "active" }, async ({ req, active: { account } }) => {
  return zipItems(account, idsQuerySchema.parse(req.nextUrl.searchParams.get("ids") ?? ""));
});

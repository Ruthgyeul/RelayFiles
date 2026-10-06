import { idsQuerySchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { zipItems } from "@/server/services/zip.service";

/** Downloads files and folders of the active account as one zip: /api/zip?ids=a,b */
export const GET = apiHandler<Response>(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return zipItems(account, idsQuerySchema.parse(req.nextUrl.searchParams.get("ids") ?? ""));
});

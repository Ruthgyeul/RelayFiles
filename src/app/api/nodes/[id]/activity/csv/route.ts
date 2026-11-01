import { nodeIdSchema } from "@/contracts/nodes";
import { CSV_UTF8_BOM } from "@/domain/csv";
import { contentDisposition } from "@/domain/serving";
import { apiHandler } from "@/server/http/api-handler";
import { linkActivityCsv } from "@/server/services/node-settings.service";

/** Share link activity of an item as a CSV download ("Download CSV" in the Activity dialog). */
export const GET = apiHandler<Response, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  const { name, csv } = await linkActivityCsv(account, nodeIdSchema.parse(params.id));
  return new Response(CSV_UTF8_BOM + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition("attachment", name),
      "cache-control": "no-store",
    },
  });
});

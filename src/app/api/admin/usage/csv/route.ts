import { usageQuerySchema } from "@/contracts/admin";
import { CSV_UTF8_BOM } from "@/domain/csv";
import { contentDisposition } from "@/domain/serving";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { usageReportCsv } from "@/server/services/usage-report.service";

/** The usage report as a CSV download; recorded in the audit log ("report.export"). */
export const GET = apiHandler<Response>({ auth: "admin" }, async ({ req, active }) => {
  const params = req.nextUrl.searchParams;
  const query = usageQuerySchema.parse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  const { name, csv } = await usageReportCsv(query);
  await audit(active, clientInfo(req.headers), "report.export", { detail: name });
  return new Response(CSV_UTF8_BOM + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition("attachment", name),
      "cache-control": "no-store",
    },
  });
});

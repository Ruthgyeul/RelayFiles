import { usageQuerySchema } from "@/contracts/admin";
import { apiHandler } from "@/server/http/api-handler";
import { usageReport } from "@/server/services/usage-report.service";

/** Admin usage report: storage, trash and share traffic per account; `?from=&to=` (UTC days). */
export const GET = apiHandler({ auth: "admin" }, async ({ req }) => {
  const params = req.nextUrl.searchParams;
  return usageReport(usageQuerySchema.parse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }));
});

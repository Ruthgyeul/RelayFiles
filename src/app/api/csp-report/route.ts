import { apiHandler } from "@/server/http/api-handler";
import { recordCspReports } from "@/server/services/csp-report.service";

/** Browsers' CSP violation reports (report-uri / report-to in the policy from src/proxy.ts). */
export const POST = apiHandler(async ({ req }) => {
  await recordCspReports(req.body);
  return new Response(null, { status: 204 });
});

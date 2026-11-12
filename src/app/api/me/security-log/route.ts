import { securityLogQuerySchema } from "@/contracts/profile";
import { apiHandler } from "@/server/http/api-handler";
import { securityLogPage } from "@/server/services/security-log.service";

/** The active account's own security log, newest first, one page per request. */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return securityLogPage(account.id, securityLogQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)));
});

import { auditQuerySchema } from "@/contracts/admin";
import { apiHandler } from "@/server/http/api-handler";
import { auditEventPage } from "@/server/services/audit.service";

/**
 * Admin audit entries, newest first (roles, deletions, sign-up mode, cleanups, invites, admin
 * tokens, ...). `?cursor=<last id>&limit=` pages, `?group=` and `?account=` filter.
 */
export const GET = apiHandler({ auth: "admin" }, async ({ req }) => {
  const params = req.nextUrl.searchParams;
  return auditEventPage(
    auditQuerySchema.parse({
      cursor: params.get("cursor") ?? undefined,
      limit: params.get("limit") ?? undefined,
      group: params.get("group") ?? undefined,
      account: params.get("account") ?? undefined,
    }),
  );
});

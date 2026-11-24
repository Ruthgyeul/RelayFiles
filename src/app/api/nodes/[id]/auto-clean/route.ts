import { autoCleanPreviewQuerySchema, autoCleanRuleSchema } from "@/contracts/auto-clean";
import { folderRefSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { getAutoClean, removeAutoClean, setAutoClean } from "@/server/services/auto-clean.service";

/** The folder's auto-clean rule and how many files it (or `?days=&basis=`) would move now. */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const query = autoCleanPreviewQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const preview = "days" in query ? { olderThanDays: query.days, basis: query.basis } : null;
  return getAutoClean(account, folderRefSchema.parse(params.id), preview);
});

/** Saves the rule; the daily job applies it from its next run. */
export const PUT = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return setAutoClean(account, folderRefSchema.parse(params.id), autoCleanRuleSchema.parse(await req.json()));
});

/** Turns the rule off (nothing that moved comes back). */
export const DELETE = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await removeAutoClean(account, folderRefSchema.parse(params.id));
  return { removed: true };
});

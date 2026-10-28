import "server-only";
import type { ApiScope } from "@/contracts/api-tokens";
import { requireApiCaller, type ApiCaller } from "../services/api-token.service";
import { apiHandler, type HandlerContext } from "./api-handler";

/**
 * A /api/v1 route: authenticated only by a personal API token with `scope` (null: any valid
 * token) in Authorization: Bearer; cookies are ignored, with the usual envelope, error masking and request id.
 */
export function apiV1Handler<T, P = Record<string, never>>(scope: ApiScope | null, handler: (ctx: HandlerContext<P> & { caller: ApiCaller }) => Promise<T | Response>) {
  return apiHandler<T, P>(async (ctx) => handler({ ...ctx, caller: await requireApiCaller(ctx.req.headers, scope) }));
}

import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { REQUEST_ID_HEADER, type ApiFailure, type ApiSuccess } from "@/contracts/api";
import { ERRORS, type ErrorCode } from "@/contracts/errors";
import { validRequestId } from "@/domain/ids";
import { deviceOf } from "../auth/current";
import { requireActive, requireAdmin, type DeviceAccount } from "../auth/device-session";
import { logger } from "../logger";
import { ApiError } from "./api-error";

export interface HandlerContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
}

export interface AuthedContext<P> extends HandlerContext<P> {
  /** The signed-in account (and its session) that the `auth` option required. */
  active: DeviceAccount;
}

/** Who may call a route: any signed-in account, or an admin from ADMIN_ALLOWED_CIDRS. */
export interface HandlerOptions {
  auth: "active" | "admin";
}

type RouteContext<P> = { params: Promise<P> };
type Handler<P, T> = (ctx: HandlerContext<P>) => Promise<T | Response>;
type AuthedHandler<P, T> = (ctx: AuthedContext<P>) => Promise<T | Response>;
type RouteHandler<P> = (req: NextRequest, context: RouteContext<P>) => Promise<Response>;

const REQUIRE = { active: requireActive, admin: requireAdmin } as const;

/** Successful JSON envelope. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

function failure(code: ErrorCode, message: string, requestId: string, extra: Omit<ApiFailure, "success" | "error" | "code"> = {}): NextResponse<ApiFailure> {
  // Never cached: a 404 for a thumbnail the worker has not made yet must not stick.
  const headers = new Headers({ [REQUEST_ID_HEADER]: requestId, "cache-control": "no-store" });
  if (extra.retryAfter) headers.set("retry-after", String(extra.retryAfter));
  return NextResponse.json({ success: false, error: message, code, ...extra }, { status: ERRORS[code].status, headers });
}

function zodFields(error: ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "(root)", issue.message]));
}

/** Converts any thrown value into a client-safe failure response. Exported for tests. */
/** 5xx answers that are part of normal operation (the client retries), not server faults to log. */
const EXPECTED_UNAVAILABLE: ReadonlySet<ErrorCode> = new Set(["MEDIA_NOT_READY"]);

export function toFailure(error: unknown, requestId: string): NextResponse<ApiFailure> {
  if (error instanceof ApiError) {
    if (error.status >= 500 && !EXPECTED_UNAVAILABLE.has(error.code)) logger.error("api error", { requestId, code: error.code, error });
    return failure(error.code, error.message, requestId, error.options);
  }
  if (error instanceof ZodError) {
    return failure("BAD_REQUEST", ERRORS.BAD_REQUEST.message, requestId, { fields: zodFields(error) });
  }
  // Unknown errors are logged in full but never exposed (no stack, query or path in the response).
  logger.error("unhandled api error", { requestId, error });
  return failure("INTERNAL", ERRORS.INTERNAL.message, requestId);
}

/**
 * Wraps a route handler: assigns a request id, awaits route params, converts thrown
 * ApiError / ZodError / unknown errors into the standard envelope, and wraps plain return
 * values in `{ success: true, data }`. With `{ auth }`, the request must come from a
 * signed-in account (401) or an admin (403) before the handler runs, which gets it as `active`.
 */
export function apiHandler<T, P = Record<string, never>>(handler: Handler<P, T>): RouteHandler<P>;
export function apiHandler<T, P = Record<string, never>>(options: HandlerOptions, handler: AuthedHandler<P, T>): RouteHandler<P>;
export function apiHandler<T, P>(first: HandlerOptions | Handler<P, T>, second?: AuthedHandler<P, T>): RouteHandler<P> {
  const handler: Handler<P, T> =
    typeof first === "function" ? first : async (ctx) => second!({ ...ctx, active: REQUIRE[first.auth](await deviceOf(ctx.req)) });
  return async (req, context) => {
    const requestId = validRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? randomUUID();
    try {
      const params = (await context?.params) ?? ({} as P);
      const result = await handler({ req, params, requestId });
      const response = result instanceof Response ? result : ok(result);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (error) {
      return toFailure(error, requestId);
    }
  };
}

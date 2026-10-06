import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { REQUEST_ID_HEADER, type ApiFailure, type ApiSuccess } from "@/contracts/api";
import { ERRORS, type ErrorCode } from "@/contracts/errors";
import { logger } from "../logger";
import { ApiError } from "./api-error";

export interface HandlerContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
}

type RouteContext<P> = { params: Promise<P> };
type Handler<P, T> = (ctx: HandlerContext<P>) => Promise<T | Response>;

/** Successful JSON envelope. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

function failure(code: ErrorCode, message: string, requestId: string, extra: Omit<ApiFailure, "success" | "error" | "code"> = {}): NextResponse<ApiFailure> {
  const headers = new Headers({ [REQUEST_ID_HEADER]: requestId });
  if (extra.retryAfter) headers.set("retry-after", String(extra.retryAfter));
  return NextResponse.json({ success: false, error: message, code, ...extra }, { status: ERRORS[code].status, headers });
}

function zodFields(error: ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "(root)", issue.message]));
}

/** Converts any thrown value into a client-safe failure response. Exported for tests. */
export function toFailure(error: unknown, requestId: string): NextResponse<ApiFailure> {
  if (error instanceof ApiError) {
    if (error.status >= 500) logger.error("api error", { requestId, code: error.code, error });
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
 * values in `{ success: true, data }`.
 */
export function apiHandler<T, P = Record<string, never>>(handler: Handler<P, T>) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    const requestId = req.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
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

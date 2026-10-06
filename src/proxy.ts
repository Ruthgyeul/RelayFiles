import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { REQUEST_ID_HEADER, type ApiFailure } from "@/contracts/api";
import { ERRORS, type ErrorCode } from "@/contracts/errors";
import { clientIp, ipInCidrs } from "@/domain/network";

/**
 * Runs before every page and API request (Next.js 16 `proxy.ts`, formerly middleware):
 * - assigns the request id shown on error pages and in logs,
 * - limits admin pages and APIs to ADMIN_ALLOWED_CIDRS when it is set,
 * - rejects cross-site writes to the API (cookie-authenticated, so a foreign Origin is refused).
 * Authorization itself is checked again in every handler; this is only the first gate.
 */

const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function apiFailure(code: ErrorCode, requestId: string): NextResponse<ApiFailure> {
  return NextResponse.json(
    { success: false, error: ERRORS[code].message, code },
    { status: ERRORS[code].status, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}

/** True when the browser says the request comes from another site. */
function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function proxy(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && !SAFE_METHODS.has(req.method) && isCrossSite(req)) return apiFailure("FORBIDDEN", requestId);

  const allowed = getEnv("app").ADMIN_ALLOWED_CIDRS;
  if (allowed.length > 0 && ADMIN_PATH.test(pathname) && !ipInCidrs(clientIp(req.headers), allowed)) {
    if (isApi) return apiFailure("FORBIDDEN", requestId);
    const response = NextResponse.rewrite(new URL("/error/403", req.url), { status: ERRORS.FORBIDDEN.status });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Skip build assets and static files; everything else (pages and API) goes through the proxy.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:woff2?|png|jpe?g|webp|svg|ico)$).*)"],
};

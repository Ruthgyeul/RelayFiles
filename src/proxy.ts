import { NextResponse, type NextRequest } from "next/server";
import { getAppEnv, getEnv } from "@/config/env";
import { REQUEST_ID_HEADER, type ApiFailure } from "@/contracts/api";
import { ERRORS, type ErrorCode } from "@/contracts/errors";
import { clientIp, ipInCidrs } from "@/domain/network";
import { ERROR_PRESETS } from "@/features/errors/presets";

/**
 * Runs before every page and API request (Next.js 16 `proxy.ts`, formerly middleware):
 * - assigns the request id shown on error pages and in logs,
 * - limits admin pages and APIs to ADMIN_ALLOWED_CIDRS when it is set,
 * - rejects cross-site writes to the API (cookie-authenticated, so a foreign Origin or a
 *   cross-site Sec-Fetch-Site is refused).
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

/**
 * The admin-range refusal for pages, answered here with a real 403. A rewrite to /error/403
 * would answer 200 and tell the client the internal upstream in `x-middleware-rewrite`. Only
 * visitors outside ADMIN_ALLOWED_CIDRS see it, so a plain page without the app shell is enough.
 */
function deniedPage(requestId: string): NextResponse {
  const { title, description } = ERROR_PRESETS["403"];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} · RelayFiles</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;text-align:center}</style></head><body><main><h1>${title}</h1><p>${description}</p><p><a href="/">Go home</a></p></main></body></html>`;
  return new NextResponse(html, {
    status: ERRORS.FORBIDDEN.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * True when the browser says the request comes from another site: `Sec-Fetch-Site:
 * cross-site`, or an Origin that is neither PUBLIC_URL nor the Host the browser addressed.
 * X-Forwarded-Host is not consulted (any client can send it).
 */
function isCrossSite(req: NextRequest): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const from = new URL(origin);
    return from.origin !== new URL(getAppEnv().PUBLIC_URL).origin && from.host !== req.headers.get("host");
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
    return isApi ? apiFailure("FORBIDDEN", requestId) : deniedPage(requestId);
  }

  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Skip build assets and static files, and tus uploads (the proxy would buffer their bodies);
  // everything else (pages and API) goes through the proxy.
  matcher: ["/((?!_next/static|_next/image|api/uploads/tus|favicon.ico|icon.svg|.*\\.(?:woff2?|png|jpe?g|webp|svg|ico)$).*)"],
};

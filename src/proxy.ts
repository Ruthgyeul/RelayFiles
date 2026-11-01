import { NextResponse, type NextRequest } from "next/server";
import { getAppEnv, getEnv } from "@/config/env";
import { REQUEST_ID_HEADER, type ApiFailure } from "@/contracts/api";
import { ERRORS, type ErrorCode } from "@/contracts/errors";
import { validRequestId } from "@/domain/ids";
import { clientIp, ipInCidrs } from "@/domain/network";
import { contentSecurityPolicy, CSP_REPORT_GROUP, CSP_REPORT_PATH, strictTransportSecurity } from "@/domain/security-headers";
import { ERROR_PRESETS } from "@/features/errors/presets";

/**
 * Runs before every page and API request (Next.js 16 `proxy.ts`, formerly middleware):
 * - assigns the request id shown on error pages and in logs,
 * - sets a per-request Content-Security-Policy nonce (Next.js reads it from the request header
 *   and adds it to its own scripts) and Strict-Transport-Security on the https site,
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

interface SecurityHeaders {
  /** Header name the policy goes in: enforced, or report-only while violations are being collected. */
  cspHeader: "content-security-policy" | "content-security-policy-report-only";
  csp: string;
  hsts: string | null;
}

function securityHeaders(req: NextRequest): SecurityHeaders {
  const env = getAppEnv();
  // 128 random bits, base64 like the Next.js CSP guide.
  const nonce = btoa(crypto.randomUUID());
  return {
    cspHeader: env.CSP_MODE === "enforce" ? "content-security-policy" : "content-security-policy-report-only",
    csp: contentSecurityPolicy({ nonce, dev: env.NODE_ENV === "development" }),
    hsts: strictTransportSecurity({ publicUrl: env.PUBLIC_URL, host: req.headers.get("host"), maxAgeSec: env.HSTS_MAX_AGE_SEC, includeSubDomains: env.HSTS_INCLUDE_SUBDOMAINS }),
  };
}

/**
 * Next.js copies these response headers onto the request it renders, so only the one policy
 * goes here: a second, enforced `content-security-policy` (say, frame-ancestors only) would be
 * read first and hide the nonce. Report-only ignores frame-ancestors; framing stays refused by
 * X-Frame-Options: DENY (next.config.ts).
 */
function withSecurityHeaders<R extends NextResponse>(response: R, security: SecurityHeaders): R {
  response.headers.set(security.cspHeader, security.csp);
  response.headers.set("reporting-endpoints", `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  if (security.hsts) response.headers.set("strict-transport-security", security.hsts);
  return response;
}

export function proxy(req: NextRequest) {
  const requestId = validRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const security = securityHeaders(req);

  if (isApi && !SAFE_METHODS.has(req.method) && isCrossSite(req)) return withSecurityHeaders(apiFailure("FORBIDDEN", requestId), security);

  const allowed = getEnv("app").ADMIN_ALLOWED_CIDRS;
  if (allowed.length > 0 && ADMIN_PATH.test(pathname) && !ipInCidrs(clientIp(req.headers), allowed)) {
    return withSecurityHeaders(isApi ? apiFailure("FORBIDDEN", requestId) : deniedPage(requestId), security);
  }

  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  // Only the full policy on the request: Next.js takes the nonce from the first CSP header it finds.
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(security.cspHeader, security.csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return withSecurityHeaders(response, security);
}

export const config = {
  // Skip build assets and static files, and uploads (the proxy would buffer their bodies): tus
  // and API v1's whole-body upload, which is Bearer-only, so the cross-site check has nothing to
  // protect there. The share sheet's post (/share-target/receive, normally answered by the service
  // worker) is skipped for the same reason: its route never reads the body and stores nothing.
  // Everything else (pages and API) goes through the proxy.
  // Static file names are skipped only outside /api: an API path ending in ".png" must still get
  // the CSRF and admin-range checks.
  matcher: ["/((?!_next/static|_next/image|api/uploads/tus|api/v1/files$|share-target/receive$|favicon.ico|icon.svg|(?!api/).*\\.(?:woff2?|png|jpe?g|webp|svg|ico)$).*)"],
};

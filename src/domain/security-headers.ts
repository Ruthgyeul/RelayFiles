/**
 * Content-Security-Policy and Strict-Transport-Security values (docs/security.md "보안 헤더").
 * The proxy builds them per request; a fresh nonce lets Next.js mark its own scripts as trusted
 * while any injected markup (an SVG, Word HTML, a future XSS) cannot run script.
 */

export const CSP_REPORT_PATH = "/api/csp-report";
/** Reporting API group name used by `report-to` and the Reporting-Endpoints header. */
export const CSP_REPORT_GROUP = "csp";

export interface CspOptions {
  nonce: string;
  /** React's development build needs eval for its error overlays; production never does. */
  dev: boolean;
}

/**
 * The policy for app pages and API responses:
 * - scripts only from this origin with the request's nonce (`strict-dynamic` lets them load chunks),
 * - inline styles allowed (React `style` props), nothing else from other origins,
 * - images from this origin plus blob:/data: (SVG and Word previews, docx images), media from
 *   this origin plus blob: (subtitle tracks converted to WebVTT in the browser), fonts from
 *   this origin only,
 * - fetch, tus uploads, pdf.js range requests and the admin event stream to this origin only,
 * - no plugins, no <base>, forms only to this origin, never framed.
 */
export function contentSecurityPolicy({ nonce, dev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export interface HstsOptions {
  /** PUBLIC_URL: HSTS only applies to the https site it names. */
  publicUrl: string;
  /** Host header of the request (LAN access by IP over http never gets HSTS). */
  host: string | null;
  maxAgeSec: number;
  includeSubDomains: boolean;
}

/** The Strict-Transport-Security value, or null when it must not be sent. */
export function strictTransportSecurity({ publicUrl, host, maxAgeSec, includeSubDomains }: HstsOptions): string | null {
  if (maxAgeSec <= 0 || !host) return null;
  let site: URL;
  try {
    site = new URL(publicUrl);
  } catch {
    return null;
  }
  if (site.protocol !== "https:" || site.host !== host.toLowerCase()) return null;
  return `max-age=${maxAgeSec}${includeSubDomains ? "; includeSubDomains" : ""}`;
}

/** One CSP violation, reduced to what is safe to log (no query strings, no page content). */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
}

const MAX_FIELD_LENGTH = 200;
const KNOWN_KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "self"]);

/** Origin + path of a URL (or a keyword such as "inline"); query and fragment dropped. */
function urlWithoutQuery(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (KNOWN_KEYWORDS.has(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "blob:" || url.protocol === "data:") return url.protocol;
    return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return value.slice(0, MAX_FIELD_LENGTH);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : "";
}

type ReportBody = Record<string, unknown>;
const isObject = (value: unknown): value is ReportBody => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Violations from a report body: the legacy `application/csp-report` object
 * (`{ "csp-report": { … } }`, kebab-case) or the Reporting API's `application/reports+json`
 * array (`[{ type: "csp-violation", body: { … } }]`, camelCase).
 */
export function parseCspReports(payload: unknown): CspViolation[] {
  const bodies: ReportBody[] = [];
  if (isObject(payload) && isObject(payload["csp-report"])) bodies.push(payload["csp-report"]);
  if (Array.isArray(payload)) {
    for (const report of payload) {
      if (isObject(report) && report.type === "csp-violation" && isObject(report.body)) bodies.push(report.body);
    }
  }
  return bodies.map((body) => ({
    directive: text(body["effectiveDirective"] ?? body["effective-directive"] ?? body["violated-directive"]),
    blocked: urlWithoutQuery(body["blockedURL"] ?? body["blocked-uri"]),
    page: urlWithoutQuery(body["documentURL"] ?? body["document-uri"]),
  }));
}

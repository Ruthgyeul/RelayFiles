/**
 * Return targets taken from a query string (`?from=`), e.g. the Retry button of the 429 page.
 * Browsers read "\" as "/" and drop tabs and newlines inside URLs, so a prefix check alone lets
 * "/\evil.com" or "/\t/evil.com" through as a protocol-relative link to another site. The path
 * is resolved the way a browser would and kept only when it stays on the same origin.
 */

/** Placeholder origin to resolve against: only "is it still this origin" matters, not which one. */
const LOCAL_ORIGIN = "http://relayfiles.invalid";
const FALLBACK_PATH = "/";
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Same-origin `pathname + search + hash` of `value`, or "/" when it would leave this site. */
export function safeReturnPath(value: string | readonly string[] | undefined): string {
  const path = typeof value === "string" ? value : value?.[0];
  if (!path || !path.startsWith("/") || path.includes("\\") || CONTROL_CHARS.test(path)) return FALLBACK_PATH;
  let url: URL;
  try {
    url = new URL(path, LOCAL_ORIGIN);
  } catch {
    return FALLBACK_PATH;
  }
  if (url.origin !== LOCAL_ORIGIN) return FALLBACK_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

import { expect, test } from "./fixtures";

/** The nonce in a CSP header value ("'nonce-…'"), or null. */
const nonceOf = (policy: string | undefined) => /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;

test("every script of a page carries the nonce of its Content-Security-Policy", async ({ request }) => {
  for (const path of ["/", "/status", "/error/429"]) {
    const response = await request.get(path);
    const headers = response.headers();
    const nonce = nonceOf(headers["content-security-policy"] ?? headers["content-security-policy-report-only"]);
    expect(nonce, path).not.toBeNull();
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const script of scripts) expect(script, path).toContain(`nonce="${nonce}"`);
  }
});

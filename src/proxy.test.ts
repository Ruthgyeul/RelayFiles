import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(adminCidrs = "") {
  vi.resetModules();
  vi.stubEnv("ADMIN_ALLOWED_CIDRS", adminCidrs);
  return (await import("./proxy")).proxy;
}

const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://files.local${path}`, { method: init.method ?? "GET", headers: { host: "files.local", ...init.headers } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("assigns a request id and keeps an incoming one", async () => {
    const proxy = await load();
    expect(proxy(request("/")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxy(request("/", { headers: { "x-request-id": "abc" } })).headers.get("x-request-id")).toBe("abc");
  });

  it("refuses cross-site API writes but allows same-site and non-browser ones", async () => {
    const proxy = await load();
    const foreign = proxy(request("/api/auth/signout", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(proxy(request("/api/auth/signout", { method: "POST", headers: { origin: "http://files.local" } })).status).toBe(200);
    expect(proxy(request("/api/auth/signout", { method: "POST" })).status).toBe(200);
    expect(proxy(request("/api/health", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });

  it("trusts PUBLIC_URL and the Host header, never X-Forwarded-Host or a cross-site fetch", async () => {
    vi.stubEnv("PUBLIC_URL", "https://files.example.com");
    const proxy = await load();
    const post = (headers: Record<string, string>) => proxy(request("/api/auth/signout", { method: "POST", headers })).status;
    expect(post({ origin: "https://files.example.com" })).toBe(200);
    expect(post({ origin: "https://evil.example", "x-forwarded-host": "evil.example" })).toBe(403);
    expect(post({ "sec-fetch-site": "cross-site" })).toBe(403);
    expect(post({ origin: "http://files.local", "sec-fetch-site": "same-origin" })).toBe(200);
  });

  it("limits admin pages and APIs to ADMIN_ALLOWED_CIDRS", async () => {
    const proxy = await load("192.168.0.0/24");
    const lan = { "x-real-ip": "192.168.0.20" };
    const wan = { "x-real-ip": "203.0.113.9" };
    expect(proxy(request("/admin/accounts", { headers: lan })).status).toBe(200);
    const page = proxy(request("/admin/accounts", { headers: wan }));
    expect(page.status).toBe(403);
    // Answered here: a rewrite would reach the browser as 200 and expose the upstream address.
    expect(page.headers.get("x-middleware-rewrite")).toBeNull();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Access denied");
    expect(proxy(request("/api/admin/accounts", { headers: wan })).status).toBe(403);
    expect(proxy(request("/administrator", { headers: wan })).status).toBe(200);
    expect(proxy(request("/files", { headers: wan })).status).toBe(200);
  });

  it("adds a fresh CSP nonce to the request and the response, report-only by default", async () => {
    const proxy = await load();
    const first = proxy(request("/files"));
    const second = proxy(request("/files"));
    const policy = first.headers.get("content-security-policy-report-only")!;
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(second.headers.get("content-security-policy-report-only")).not.toBe(policy);
    // No second, enforced policy: Next.js would read it from the request and miss the nonce.
    expect(first.headers.get("content-security-policy")).toBeNull();
    expect(first.headers.get("reporting-endpoints")).toBe('csp="/api/csp-report"');
    // Next.js reads the nonce from the request header the page renders with.
    expect(first.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(policy);
  });

  it("enforces the policy with CSP_MODE=enforce and ignores a policy the client sent", async () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const proxy = await load();
    const res = proxy(request("/files", { headers: { "content-security-policy": "script-src 'nonce-attacker'" } }));
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("attacker");
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("sends HSTS only for the https PUBLIC_URL host", async () => {
    vi.stubEnv("PUBLIC_URL", "https://files.local");
    const proxy = await load();
    expect(proxy(request("/files")).headers.get("strict-transport-security")).toBe("max-age=31536000");
    const lan = new NextRequest("http://192.168.0.100/files", { headers: { host: "192.168.0.100" } });
    expect(proxy(lan).headers.get("strict-transport-security")).toBeNull();
  });

  it("leaves admin paths open when no networks are configured", async () => {
    const proxy = await load("");
    expect(proxy(request("/admin/server", { headers: { "x-real-ip": "203.0.113.9" } })).status).toBe(200);
  });
});

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

  it("limits admin pages and APIs to ADMIN_ALLOWED_CIDRS", async () => {
    const proxy = await load("192.168.0.0/24");
    const lan = { "x-real-ip": "192.168.0.20" };
    const wan = { "x-real-ip": "203.0.113.9" };
    expect(proxy(request("/admin/accounts", { headers: lan })).status).toBe(200);
    const page = proxy(request("/admin/accounts", { headers: wan }));
    expect(page.status).toBe(403);
    expect(page.headers.get("x-middleware-rewrite")).toContain("/error/403");
    expect(proxy(request("/api/admin/accounts", { headers: wan })).status).toBe(403);
    expect(proxy(request("/administrator", { headers: wan })).status).toBe(200);
    expect(proxy(request("/files", { headers: wan })).status).toBe(200);
  });

  it("leaves admin paths open when no networks are configured", async () => {
    const proxy = await load("");
    expect(proxy(request("/admin/server", { headers: { "x-real-ip": "203.0.113.9" } })).status).toBe(200);
  });
});

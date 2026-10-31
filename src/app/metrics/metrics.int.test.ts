import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import { PROMETHEUS_CONTENT_TYPE } from "@/domain/prometheus";
import { callRoute } from "../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../test/file-fixtures";

// Lets a test place the scraper outside ADMIN_ALLOWED_CIDRS.
const network = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/server/auth/admin-network", () => ({ fromAdminNetwork: () => network.allowed }));

const { GET: metrics } = await import("./route");
const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

async function admin(): Promise<FixtureMember> {
  const m = await member();
  await prisma.account.update({ where: { id: m.id }, data: { isAdmin: true } });
  return m;
}

async function tokenFor(m: FixtureMember, scopes: string[]) {
  const res = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "grafana", scopes, expiresInDays: null } });
  expect(res.status).toBe(201);
  return res.json.data.token;
}

const scrape = (token?: string) => metrics(new NextRequest("http://localhost/metrics", { headers: token ? { authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({}) });

describe("/metrics", () => {
  it("answers Prometheus text to an admin token with metrics:read, naming no account", async () => {
    const m = await admin();
    const res = await scrape(await tokenFor(m, ["metrics:read"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
    const text = await res.text();
    expect(text).toMatch(/^# HELP relayfiles_cpu_usage_percent /m);
    expect(text).toMatch(/^relayfiles_accounts \d+$/m);
    expect(text).toMatch(/^relayfiles_media_queue_jobs\{state="waiting"\} \d+$/m);
    expect(text).toMatch(/^relayfiles_service_up\{service="web_server"\} 1$/m);
    expect(text).toMatch(/^relayfiles_transcodes_started_total \d+$/m);
    expect(text).toMatch(/^relayfiles_scrape_errors 0$/m);
    expect(text).toMatch(/^relayfiles_up 1$/m);
    expect(text).not.toContain(m.id);
  });

  it("refuses no token, a token without metrics:read, a member and the wrong network", async () => {
    const m = await admin();
    expect((await scrape()).status).toBe(401);
    expect((await scrape(await tokenFor(m, ["files:read"]))).status).toBe(403);

    const token = await tokenFor(m, ["metrics:read"]);
    network.allowed = false;
    try {
      expect((await scrape(token)).status).toBe(403);
    } finally {
      network.allowed = true;
    }
    // Demoted after creating the token: it no longer reads metrics.
    await prisma.account.update({ where: { id: m.id }, data: { isAdmin: false } });
    expect((await scrape(token)).status).toBe(403);
  });
});

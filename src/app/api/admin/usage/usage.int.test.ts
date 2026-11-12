import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { GET as audit } from "@/app/api/admin/audit/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import { MS } from "@/config/policy";
import type { SessionState } from "@/contracts/auth";
import type { AuditPage, UsageReport } from "@/contracts/admin";
import { newNodeId, newLinkId } from "@/domain/ids";
import { addTraffic } from "@/server/repositories/traffic.repo";
import { createAdminAccount } from "@/server/services/auth.service";
import { callRoute, callRouteRaw } from "../../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../../test/file-fixtures";
import { GET as usageCsv } from "./csv/route";
import { GET as usage } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();
const admins: string[] = [];

afterAll(async () => {
  await prisma.account.deleteMany({ where: { id: { in: admins } } });
  await cleanup();
});

async function signedInAdmin() {
  const { account, token } = await createAdminAccount();
  admins.push(account.id);
  const res = await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() });
  return { id: account.id, cookie: res.cookie! };
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("admin usage report", () => {
  it("is for admins only", async () => {
    const m = await member();
    expect((await callRoute(usage, { cookie: m.cookie })).status).toBe(403);
    expect((await callRouteRaw(usageCsv, { cookie: m.cookie })).status).toBe(403);
  });

  it("adds up each account's storage, trash, traffic in the range and tokens", async () => {
    const admin = await signedInAdmin();
    const m = await member();
    const other = await member();
    await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    await prisma.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Docs", linkId: newLinkId() } });
    await prisma.trashedBytes.create({ data: { id: randomUUID(), accountId: m.id, bytes: 40n } });
    const now = Date.now();
    await addTraffic(prisma, m.id, 700n, new Date(now));
    await addTraffic(prisma, m.id, 300n, new Date(now - 5 * MS.day));
    await addTraffic(prisma, m.id, 9_000n, new Date(now - 40 * MS.day));
    await addTraffic(prisma, other.id, 11n, new Date(now));
    expect((await callRoute(createToken, { method: "POST", cookie: m.cookie, body: { name: "sync", scopes: ["files:read"], expiresInDays: null } })).status).toBe(201);

    const report = (await callRoute<UsageReport>(usage, { cookie: admin.cookie })).json.data;
    expect(report).toMatchObject({ from: day(now - 29 * MS.day), to: day(now), days: 30 });
    const row = report.rows.find((entry) => entry.id === m.id);
    // The root folder counts as a folder too.
    expect(row).toMatchObject({ isAdmin: false, usedBytes: "5", files: 1, folders: 2, trashBytes: "40", trafficBytes: "1000", apiTokens: 1 });
    expect(report.rows.find((entry) => entry.id === other.id)).toMatchObject({ usedBytes: "0", files: 0, trashBytes: "0", trafficBytes: "11", apiTokens: 0 });
    expect(report.rows.find((entry) => entry.id === admin.id)?.isAdmin).toBe(true);
    expect(report.months.at(-1)!.month).toBe(day(now).slice(0, 7));
    expect(report.months.reduce((sum, entry) => sum + BigInt(entry.bytes), 0n)).toBeGreaterThanOrEqual(1011n);

    const wide = (await callRoute<UsageReport>(usage, { cookie: admin.cookie, query: `?from=${day(now - 60 * MS.day)}&to=${day(now)}` })).json.data;
    expect(wide.rows.find((entry) => entry.id === m.id)?.trafficBytes).toBe("10000");
  });

  it("refuses ranges that are reversed or longer than a year", async () => {
    const admin = await signedInAdmin();
    const reversed = await callRoute(usage, { cookie: admin.cookie, query: "?from=2026-11-02&to=2026-11-01" });
    expect(reversed.status).toBe(400);
    expect(reversed.json.error).toBe("The range ends before it starts.");
    expect((await callRoute(usage, { cookie: admin.cookie, query: "?from=2025-01-01&to=2026-01-02" })).status).toBe(400);
    expect((await callRoute(usage, { cookie: admin.cookie, query: "?from=yesterday" })).status).toBe(400);
  });

  it("downloads a formula-safe CSV and records it in the audit log", async () => {
    const admin = await signedInAdmin();
    const m = await member();
    await prisma.account.update({ where: { id: m.id }, data: { name: "=HYPERLINK(1)" } });
    const res = await callRouteRaw(usageCsv, { cookie: admin.cookie, query: "?from=2026-10-01&to=2026-10-31" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("relayfiles-usage-2026-10-01-2026-10-31.csv");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toContain("Account ID,Name,Role");
    expect(text).toContain(`${m.id},'=HYPERLINK(1),Member`);

    const entries = (await callRoute<AuditPage>(audit, { cookie: admin.cookie, query: "?group=accounts" })).json.data.events;
    expect(entries.find((entry) => entry.actorId === admin.id)).toMatchObject({ action: "report.export", detail: "relayfiles-usage-2026-10-01-2026-10-31.csv" });
  });
});

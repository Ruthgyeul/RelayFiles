import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteIncident, PUT as editIncident } from "@/app/api/admin/incidents/[id]/route";
import { POST as postIncident } from "@/app/api/admin/incidents/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { GET as status } from "@/app/api/status/route";
import { MS } from "@/config/policy";
import type { SessionState } from "@/contracts/auth";
import type { StatusData } from "@/contracts/status";
import { probeApp, recordProbe } from "@/server/jobs/health-probe";
import { createAdminAccount } from "@/server/services/auth.service";
import { invalidate, cacheKey } from "@/server/cache/cached";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../test/file-fixtures";

const { prisma, member, cleanup } = fileFixtures();
const admins: string[] = [];
const incidents: string[] = [];
// Probe history in the past, so it can't be confused with a running worker's samples.
const base = new Date(Date.UTC(2001, 0, 10, 12));
const healthy = { reachable: true, database: true, redis: true, storage: true, writable: true };

beforeAll(async () => {
  await prisma.healthSample.deleteMany({ where: { at: { lt: new Date(Date.UTC(2002, 0, 1)) } } });
});

afterAll(async () => {
  await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
  await prisma.healthSample.deleteMany({ where: { at: { lt: new Date(Date.UTC(2002, 0, 1)) } } });
  await prisma.healthHourly.deleteMany({ where: { hour: { lt: new Date(Date.UTC(2002, 0, 1)) } } });
  await prisma.healthDaily.deleteMany({ where: { day: { lt: new Date(Date.UTC(2002, 0, 1)) } } });
  await prisma.account.deleteMany({ where: { id: { in: admins } } });
  await invalidate([cacheKey.status()]);
  await cleanup();
});

async function adminCookie() {
  const { account, token } = await createAdminAccount();
  admins.push(account.id);
  return (await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() })).cookie!;
}

describe("health probes", () => {
  it("records every component and rolls up hours and days", async () => {
    await recordProbe({ probe: healthy, ms: 40 }, base);
    await recordProbe({ probe: healthy, ms: 60 }, new Date(base.getTime() + MS.minute));
    await recordProbe({ probe: { ...healthy, redis: false }, ms: 50 }, new Date(base.getTime() + 2 * MS.minute));

    const hourly = await prisma.healthHourly.findMany({ where: { hour: base } });
    expect(hourly.find((row) => row.component === "website")).toMatchObject({ okCount: 3, failCount: 0, avgMs: 50 });
    expect(hourly.find((row) => row.component === "uploads")).toMatchObject({ okCount: 2, failCount: 1, avgMs: null });

    const daily = await prisma.healthDaily.findMany({ where: { day: new Date("2001-01-10T00:00:00Z") } });
    expect(daily).toHaveLength(6);
    expect(daily.find((row) => row.component === "shares")).toMatchObject({ okCount: 2, failCount: 1, level: "DOWN" });
    expect(daily.find((row) => row.component === "storage")).toMatchObject({ okCount: 3, failCount: 0, level: "OK" });
  });

  it("reports an unreachable app as down", async () => {
    const outcome = await probeApp("http://127.0.0.1:9/api/health");
    expect(outcome.ms).toBeNull();
    expect(outcome.probe).toMatchObject({ reachable: false, database: false });
  });
});

describe("status page data", () => {
  it("is public and covers 48 hours, 60 days and six services", async () => {
    await invalidate([cacheKey.status()]);
    const res = await callRoute<StatusData>(status);
    expect(res.status).toBe(200);
    const data = res.json.data;
    expect(data.latency).toHaveLength(48);
    expect(data.components.map((component) => component.name)).toEqual(["Website", "Uploads", "Streaming", "Downloads", "Share links", "Storage"]);
    expect(data.components.every((component) => component.days.length === 60)).toBe(true);
    expect(data.server.location).toBeTruthy();
    expect(data.server.tls.state).toBeDefined();
  });

  it("lets admins post, edit and delete incidents", async () => {
    const m = await member();
    const body = { title: "  Slow streaming  ", text: "Fixed a disk cache.", severity: "major", date: "2026-10-02", duration: "25 min", resolved: false };
    expect((await callRoute(postIncident, { method: "POST", cookie: m.cookie, body })).status).toBe(403);

    const cookie = await adminCookie();
    expect((await callRoute(postIncident, { method: "POST", cookie, body: { ...body, title: " " } })).status).toBe(400);
    const posted = await callRoute<{ id: string }>(postIncident, { method: "POST", cookie, body });
    expect(posted.status).toBe(200);
    const id = posted.json.data.id;
    incidents.push(id);
    let listed = (await callRoute<StatusData>(status)).json.data.incidents;
    expect(listed.find((incident) => incident.id === id)).toMatchObject({ title: "Slow streaming", severity: "major", date: "2026-10-02", resolved: false });

    expect((await callRoute(editIncident, { method: "PUT", cookie, params: { id }, body: { ...body, resolved: true } })).status).toBe(200);
    listed = (await callRoute<StatusData>(status)).json.data.incidents;
    expect(listed.find((incident) => incident.id === id)?.resolved).toBe(true);

    expect((await callRoute(deleteIncident, { method: "DELETE", cookie, params: { id } })).status).toBe(200);
    expect((await callRoute(deleteIncident, { method: "DELETE", cookie, params: { id } })).status).toBe(404);
    listed = (await callRoute<StatusData>(status)).json.data.incidents;
    expect(listed.some((incident) => incident.id === id)).toBe(false);
  });
});

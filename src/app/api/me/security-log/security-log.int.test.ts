import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { POST as reauth } from "@/app/api/auth/reauth/route";
import { POST as signOut } from "@/app/api/auth/signout/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import { DELETE as revokeToken } from "@/app/api/me/api-tokens/[id]/route";
import { DELETE as signOutOthers, GET as devices } from "@/app/api/me/sessions/route";
import { DELETE as signOutDevice } from "@/app/api/me/sessions/[id]/route";
import { GET as revealToken, POST as newToken } from "@/app/api/me/token/route";
import { MS, SECURITY_LOG } from "@/config/policy";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import type { SessionState } from "@/contracts/auth";
import type { DeviceDto, SecurityLogPage } from "@/contracts/profile";
import { requireApiCaller } from "@/server/services/api-token.service";
import { purgeOldAccountEvents } from "@/server/services/security-log.service";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../../test/file-fixtures";
import { GET as securityLog } from "./route";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

const tokenOf = async (m: FixtureMember) => (await callRoute<{ token: string }>(revealToken, { cookie: m.cookie })).json.data.token;
const kindsOf = async (m: FixtureMember, query = "") => (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie, query })).json.data.events.map((entry) => entry.kind);

async function secondDevice(m: FixtureMember) {
  const res = await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token: await tokenOf(m) }, ip: randomTestIp() });
  expect(res.status).toBe(200);
  return res.cookie!;
}

describe("security log", () => {
  it("records sign-up, sign-in and sign-out, newest first, for the account only", async () => {
    const m = await member();
    const other = await member();
    const phone = await secondDevice(m);
    expect((await callRoute(signOut, { method: "POST", cookie: phone, body: {} })).status).toBe(200);

    expect(await kindsOf(m)).toEqual(["signout", "signin", "account.created"]);
    expect(await kindsOf(other)).toEqual(["account.created"]);
    const [latest] = (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie })).json.data.events;
    expect(latest).toMatchObject({ os: "Linux", browser: "Firefox", detail: null });
    expect(latest!.ipMasked).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it("records device sign-outs and a new token with the API tokens it revoked", async () => {
    const m = await member();
    const phone = await secondDevice(m);
    await secondDevice(m);
    const phoneId = (await callRoute<DeviceDto[]>(devices, { cookie: phone })).json.data.find((device) => device.current)!.id;
    expect((await callRoute(signOutDevice, { method: "DELETE", cookie: m.cookie, params: { id: phoneId } })).status).toBe(200);
    expect((await callRoute(signOutOthers, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
    expect((await callRoute(createToken, { method: "POST", cookie: m.cookie, body: { name: "backup", scopes: ["files:read"], expiresInDays: null } })).status).toBe(201);
    expect((await callRoute(newToken, { method: "POST", cookie: m.cookie })).status).toBe(200);

    const events = (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie })).json.data.events;
    expect(events.slice(0, 4).map(({ kind, detail }) => ({ kind, detail }))).toEqual([
      { kind: "token.regenerated", detail: "1 API token revoked" },
      { kind: "apiToken.created", detail: "backup (files:read)" },
      { kind: "devices.signout", detail: "1 device" },
      { kind: "device.signout", detail: "Linux · Firefox" },
    ]);
  });

  it("records a confirmed and a refused token entry", async () => {
    const m = await member();
    const ip = randomTestIp();
    expect((await callRoute(reauth, { method: "POST", cookie: m.cookie, body: { token: "x".repeat(36) }, ip })).status).toBe(401);
    expect((await callRoute(reauth, { method: "POST", cookie: m.cookie, body: { token: await tokenOf(m) }, ip })).status).toBe(200);
    expect((await kindsOf(m)).slice(0, 2)).toEqual(["reauth", "reauth.failed"]);
  });

  it("records a refused API token once per window and a revoked one", async () => {
    const m = await member();
    const created = (await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "sync", scopes: ["files:read"], expiresInDays: null } })).json.data;
    const wrong = `${created.token.slice(0, -4)}zzzz`;
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(requireApiCaller(new Headers({ authorization: `Bearer ${wrong}` }), null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    // An id that names no token is no one's event.
    await expect(requireApiCaller(new Headers({ authorization: "Bearer rfp_nosuchtoken0_secret" }), null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await callRoute(revokeToken, { method: "DELETE", cookie: m.cookie, params: { id: created.item.id } })).status).toBe(200);

    const events = (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie })).json.data.events;
    expect(events.filter((entry) => entry.kind === "apiToken.rejected").map((entry) => entry.detail)).toEqual(["sync: wrong secret"]);
    expect(events[0]).toMatchObject({ kind: "apiToken.revoked", detail: "sync" });
  });

  it("pages with a cursor and refuses another account's cursor", async () => {
    const m = await member();
    const other = await member();
    await secondDevice(m);
    await secondDevice(m);
    const first = (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie, query: "?limit=2" })).json.data;
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const rest = (await callRoute<SecurityLogPage>(securityLog, { cookie: m.cookie, query: `?limit=2&cursor=${first.nextCursor}` })).json.data;
    expect(rest.events.map((entry) => entry.kind)).toEqual(["account.created"]);
    expect(rest.nextCursor).toBeNull();
    expect((await callRoute(securityLog, { cookie: other.cookie, query: `?cursor=${first.nextCursor}` })).status).toBe(400);
  });

  it("drops entries older than the retention", async () => {
    const m = await member();
    const now = new Date();
    const old = {
      id: randomUUID(),
      accountId: m.id,
      kind: "signin",
      os: "Linux",
      browser: "Firefox",
      ipMasked: "10.0.•••.•••",
      at: new Date(now.getTime() - (SECURITY_LOG.retentionDays + 1) * MS.day),
    };
    await prisma.accountEvent.create({ data: old });
    expect(await purgeOldAccountEvents(now)).toBeGreaterThanOrEqual(1);
    expect(await prisma.accountEvent.count({ where: { id: old.id } })).toBe(0);
    expect(await kindsOf(m)).toEqual(["account.created"]);
  });
});

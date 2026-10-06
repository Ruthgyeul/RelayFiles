import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { DELETE as deleteMe } from "@/app/api/me/route";
import { PATCH as preferences } from "@/app/api/me/preferences/route";
import { POST as purge } from "@/app/api/me/purge/route";
import { DELETE as signOutOthers, GET as devices } from "@/app/api/me/sessions/route";
import { DELETE as signOutDevice } from "@/app/api/me/sessions/[id]/route";
import { GET as revealToken, POST as newToken } from "@/app/api/me/token/route";
import type { SessionState } from "@/contracts/auth";
import type { DeviceDto } from "@/contracts/profile";
import { newLinkId, newNodeId } from "@/domain/ids";
import { profileOf } from "@/server/services/profile.service";
import { addTraffic } from "@/server/repositories/traffic.repo";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const tokenOf = async (m: FixtureMember) => (await callRoute<{ token: string }>(revealToken, { cookie: m.cookie })).json.data.token;

/** Signs the same account in on a second device; returns that device's cookie. */
async function secondDevice(m: FixtureMember) {
  const res = await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token: await tokenOf(m) }, ip: randomTestIp() });
  expect(res.status).toBe(200);
  return res.cookie!;
}

const accountsOn = async (cookie: string) => (await callRoute<SessionState>(session, { cookie })).json.data.accounts.length;

describe("profile", () => {
  it("adds up storage, content and 30 days of traffic", async () => {
    const m = await member();
    await addFile(m, m.rootId, [], "a.txt", "12345", "text/plain");
    await prisma.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Docs", linkId: newLinkId() } });
    const now = new Date();
    await addTraffic(prisma, m.id, 700n, now);
    await addTraffic(prisma, m.id, 300n, new Date(now.getTime() - 40 * 86_400_000));
    const account = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    const sessionId = (await prisma.session.findFirstOrThrow({ where: { accountId: m.id } })).id;

    const profile = await profileOf(account, sessionId, now);
    expect(profile.usage).toEqual({ usedBytes: "5", files: 1, folders: 1 });
    expect(profile.traffic.total).toBe("700");
    expect(profile.traffic.days).toHaveLength(30);
    expect(profile.traffic.days.at(-1)).toBe("700");
    expect(profile.maskedToken).toMatch(/^.{4}•{28}.{4}$/);
    expect(profile.account).toMatchObject({ isAdmin: false, extended: false, stripMetadataOnShare: true });
    expect(profile.devices).toMatchObject([{ current: true, location: "Local network", browser: "Firefox" }]);
  });
});

describe("devices and token", () => {
  it("lists devices and signs out one or all others", async () => {
    const m = await member();
    const phone = await secondDevice(m);
    const laptop = await secondDevice(m);
    const list = (await callRoute<DeviceDto[]>(devices, { cookie: m.cookie })).json.data;
    expect(list).toHaveLength(3);
    expect(list[0]!.current).toBe(true);

    const phoneId = (await callRoute<DeviceDto[]>(devices, { cookie: phone })).json.data.find((device) => device.current)!.id;
    expect((await callRoute(signOutDevice, { method: "DELETE", cookie: m.cookie, params: { id: phoneId } })).status).toBe(200);
    expect(await accountsOn(phone)).toBe(0);
    expect(await accountsOn(laptop)).toBe(1);

    const others = await callRoute<{ signedOut: number }>(signOutOthers, { method: "DELETE", cookie: m.cookie });
    expect(others.json.data.signedOut).toBe(1);
    expect(await accountsOn(laptop)).toBe(0);
    expect(await accountsOn(m.cookie)).toBe(1);
  });

  it("replaces the token: the old one stops working and other devices are signed out", async () => {
    const m = await member();
    const oldToken = await tokenOf(m);
    const phone = await secondDevice(m);
    const res = await callRoute<{ token: string }>(newToken, { method: "POST", cookie: m.cookie });
    expect(res.status).toBe(200);
    expect(res.json.data.token).not.toBe(oldToken);
    expect(await tokenOf(m)).toBe(res.json.data.token);
    expect(await accountsOn(phone)).toBe(0);
    expect(await accountsOn(m.cookie)).toBe(1);
    const stale = await callRoute(tokenSignIn, { method: "POST", body: { token: oldToken }, ip: randomTestIp() });
    expect(stale.status).toBe(401);
  });
});

describe("preferences, purge and deletion", () => {
  it("saves the metadata preference", async () => {
    const m = await member();
    const res = await callRoute(preferences, { method: "PATCH", cookie: m.cookie, body: { stripMetadataOnShare: false } });
    expect(res.status).toBe(200);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: m.id } })).stripMetadataOnShare).toBe(false);
  });

  it("purges expired and used delete-after-download items only", async () => {
    const m = await member();
    const old = await addFile(m, m.rootId, [], "old.txt", "x", "text/plain");
    const used = await addFile(m, m.rootId, [], "used.txt", "y", "text/plain");
    const keep = await addFile(m, m.rootId, [], "keep.txt", "z", "text/plain");
    await prisma.node.update({ where: { id: old }, data: { expAt: new Date(Date.now() - 1_000) } });
    await prisma.node.update({ where: { id: used }, data: { burn: true, downloads: 1 } });
    await prisma.node.update({ where: { id: keep }, data: { burn: true, expAt: new Date(Date.now() + 86_400_000) } });

    const res = await callRoute<{ deleted: number }>(purge, { method: "POST", cookie: m.cookie });
    expect(res.json.data.deleted).toBe(2);
    expect((await prisma.node.findMany({ where: { accountId: m.id, type: "FILE" } })).map((row) => row.name)).toEqual(["keep.txt"]);
    expect((await callRoute<{ deleted: number }>(purge, { method: "POST", cookie: m.cookie })).json.data.deleted).toBe(0);
  });

  it("deletes the account with its files and signs it out", async () => {
    const m = await member();
    await addFile(m, m.rootId, [], "a.txt", "bye", "text/plain");
    const res = await callRoute<SessionState>(deleteMe, { method: "DELETE", cookie: m.cookie });
    expect(res.status).toBe(200);
    expect(res.json.data.accounts).toEqual([]);
    expect(await prisma.account.findUnique({ where: { id: m.id } })).toBeNull();
    expect(await stat(join(m.dir, "a.txt")).catch(() => null)).toBeNull();
  });
});

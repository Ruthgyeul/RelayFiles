import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import { GET as v1Shares } from "@/app/api/v1/shares/route";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import type { SharedView } from "@/contracts/shares";
import { newLinkId, newNodeId } from "@/domain/ids";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { GET as listShares } from "./route";
import { POST as makePrivate } from "./private/route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

async function folder(m: FixtureMember, parentId: string, name: string, visibility: "INHERIT" | "PRIVATE" | "PUBLIC" = "INHERIT") {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, visibility, linkId: newLinkId() } });
  return id;
}

const names = (view: SharedView) => view.items.map((item) => item.name).sort();

/**
 * Album (public) holding a.jpg (inherits) and locked.jpg (password), Drafts (private) holding
 * stale.txt (a limit left over, not reachable), and solo.txt (public) at the top.
 */
async function tree(m: FixtureMember) {
  const album = await folder(m, m.rootId, "Album", "PUBLIC");
  await addFile(m, album, ["Album"], "a.jpg", "a", "image/jpeg");
  const locked = await addFile(m, album, ["Album"], "locked.jpg", "b", "image/jpeg");
  await prisma.node.update({ where: { id: locked }, data: { passwordHash: "argon2-hash" } });
  const drafts = await folder(m, m.rootId, "Drafts", "PRIVATE");
  const stale = await addFile(m, drafts, ["Drafts"], "stale.txt", "c", "text/plain");
  await prisma.node.update({ where: { id: stale }, data: { downloadLimit: 3 } });
  const solo = await addFile(m, m.rootId, [], "solo.txt", "d", "text/plain");
  await prisma.node.update({ where: { id: solo }, data: { visibility: "PUBLIC" } });
  return { album, locked, solo };
}

describe("shared by me", () => {
  it("lists the tops of public parts and items with limits of their own, with their last activity", async () => {
    const m = await member();
    const { album, locked } = await tree(m);
    await prisma.linkEvent.create({ data: { nodeId: album, kind: "OPEN", fileName: "Album", at: new Date("2026-11-01T10:00:00Z") } });
    await prisma.linkEvent.create({ data: { nodeId: album, kind: "DOWNLOAD", fileName: "Album", at: new Date("2026-11-02T10:00:00Z") } });

    const res = await callRoute<SharedView>(listShares, { cookie: m.cookie });
    expect(res.status).toBe(200);
    expect(names(res.json.data)).toEqual(["Album", "locked.jpg", "solo.txt"]);
    expect(res.json.data.truncated).toBe(false);
    const byName = new Map(res.json.data.items.map((item) => [item.name, item]));
    expect(byName.get("Album")?.lastActivityAt).toBe("2026-11-02T10:00:00.000Z");
    expect(byName.get("solo.txt")?.lastActivityAt).toBeNull();
    expect(byName.get("locked.jpg")?.parentPath).toMatch(/Album$/);
    expect(byName.get("locked.jpg")?.settings.hasPassword).toBe(true);
    expect(byName.get("locked.jpg")?.id).toBe(locked);
  });

  it("keeps accounts apart", async () => {
    const m = await member();
    const other = await member();
    await tree(other);
    expect((await callRoute<SharedView>(listShares, { cookie: m.cookie })).json.data.items).toEqual([]);
  });

  it("makes items private all at once, and refuses another account's items", async () => {
    const m = await member();
    const other = await member();
    const { album, solo } = await tree(m);
    const theirs = await tree(other);

    const refused = await callRoute(makePrivate, { method: "POST", cookie: m.cookie, body: { ids: [solo, theirs.solo] } });
    expect(refused.status).toBe(404);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: solo } })).visibility).toBe("PUBLIC");

    const done = await callRoute<{ updated: number }>(makePrivate, { method: "POST", cookie: m.cookie, body: { ids: [album, solo] } });
    expect(done.json.data.updated).toBe(2);
    // locked.jpg was public only through Album: private now, so nothing is listed.
    expect((await callRoute<SharedView>(listShares, { cookie: m.cookie })).json.data.items).toEqual([]);
    expect((await callRoute(makePrivate, { method: "POST", cookie: m.cookie, body: { ids: [] } })).status).toBe(400);
  });

  it("is in API v1 with files:read", async () => {
    const m = await member();
    await tree(m);
    const created = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "script", scopes: ["files:read"], expiresInDays: null } });
    const call = (token: string) => v1Shares(new NextRequest("http://localhost/api/v1/shares", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({}) });
    const res = await call(created.json.data.token);
    expect(res.status).toBe(200);
    expect(names(((await res.json()) as { data: SharedView }).data)).toEqual(["Album", "locked.jpg", "solo.txt"]);

    const writeOnly = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "w", scopes: ["files:write"], expiresInDays: null } });
    expect((await call(writeOnly.json.data.token)).status).toBe(403);
  });
});

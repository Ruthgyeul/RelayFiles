import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { GET as getFolder } from "@/app/api/folders/[id]/route";
import { POST as createFolder } from "@/app/api/folders/route";
import { GET as activity } from "@/app/api/nodes/[id]/activity/route";
import { POST as newLink } from "@/app/api/nodes/[id]/link/route";
import { PUT as pause } from "@/app/api/nodes/[id]/pause/route";
import { PATCH as rename } from "@/app/api/nodes/[id]/route";
import { PUT as settings } from "@/app/api/nodes/[id]/settings/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { POST as tags } from "@/app/api/nodes/tags/route";
import { POST as transfer } from "@/app/api/nodes/transfer/route";
import type { CreatedAccount } from "@/contracts/auth";
import type { CreatedFolder, FolderView, LinkEventDto, NodeItem, TransferResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { createAdminAccount } from "@/server/services/auth.service";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { callRoute } from "../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];
const ip = `198.18.${Math.floor(Math.random() * 200) + 20}.2`;

interface Session {
  id: string;
  cookie: string;
  root: string;
}

async function member(): Promise<Session> {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip });
  const id = res.json.data.account.id;
  accounts.push(id);
  return { id, cookie: res.cookie!, root: userRootOf(configuredVolumeRoot(), id) };
}

async function admin(): Promise<Session> {
  const { account, token } = await createAdminAccount();
  accounts.push(account.id);
  const res = await callRoute(tokenSignIn, { method: "POST", body: { token }, ip });
  return { id: account.id, cookie: res.cookie!, root: userRootOf(configuredVolumeRoot(), account.id) };
}

const folder = async (s: Session, parentId: string, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: s.cookie, body: { parentId, name } })).json.data.folder;
const list = async (s: Session, id = "root") => (await callRoute<FolderView, { id: string }>(getFolder, { cookie: s.cookie, params: { id } })).json.data;

/** Adds a file row and its bytes on disk (uploads arrive in M7). */
async function file(s: Session, parentId: string, segments: string[], name: string, content = "hello") {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: s.id, parentId, type: "FILE", kind: "OTHER", name, size: BigInt(content.length), linkId: newLinkId() } });
  await writeFile(join(s.root, ...segments, name), content);
  return id;
}

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("rename", () => {
  it("renames on disk and refuses taken names with a suggestion", async () => {
    const s = await member();
    const a = await folder(s, "root", "A");
    await folder(s, "root", "B");
    const renamed = await callRoute<NodeItem, { id: string }>(rename, { method: "PATCH", cookie: s.cookie, params: { id: a.id }, body: { name: "Movies" } });
    expect(renamed.json.data.name).toBe("Movies");
    await access(join(s.root, "Movies"));

    const taken = await callRoute(rename, { method: "PATCH", cookie: s.cookie, params: { id: a.id }, body: { name: "B" } });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe('Server rejected: "B" already exists here. Suggested: B (2)');
    expect((await callRoute(rename, { method: "PATCH", cookie: s.cookie, params: { id: a.id }, body: { name: ".." } })).status).toBe(400);
  });
});

describe("move and copy", () => {
  it("moves items and their bytes, renaming clashes and skipping impossible targets", async () => {
    const s = await member();
    const docs = await folder(s, "root", "Docs");
    const inner = await folder(s, docs.id, "Inner");
    const f1 = await file(s, (await list(s)).folder.id, [], "a.txt", "one");
    await file(s, docs.id, ["Docs"], "a.txt", "two");

    const moved = await callRoute<TransferResult>(transfer, { method: "POST", cookie: s.cookie, body: { ids: [f1], targetId: docs.id, mode: "move" } });
    expect(moved.json.data).toEqual({ done: 1, renamed: 1, targetName: "Docs" });
    expect(await readFile(join(s.root, "Docs", "a (2).txt"), "utf8")).toBe("one");

    const intoSelf = await callRoute(transfer, { method: "POST", cookie: s.cookie, body: { ids: [docs.id], targetId: inner.id, mode: "move" } });
    expect(intoSelf.status).toBe(400);
    expect(intoSelf.json.error).toBe("Can't move there");
  });

  it("copies folders with everything inside as new items", async () => {
    const s = await member();
    const src = await folder(s, "root", "Src");
    const sub = await folder(s, src.id, "Sub");
    await file(s, sub.id, ["Src", "Sub"], "x.txt", "copy me");
    await prisma.node.update({ where: { id: src.id }, data: { tags: ["keep"], downloads: 7 } });

    const copied = await callRoute<TransferResult>(transfer, { method: "POST", cookie: s.cookie, body: { ids: [src.id], targetId: "root", mode: "copy" } });
    expect(copied.json.data).toEqual({ done: 1, renamed: 1, targetName: "root" });
    expect(await readFile(join(s.root, "Src (2)", "Sub", "x.txt"), "utf8")).toBe("copy me");

    const root = await list(s);
    const copy = root.children.find((c) => c.name === "Src (2)")!;
    expect(copy).toMatchObject({ tags: ["keep"], downloads: 0, itemCount: 1, size: "7" });
    expect(copy.linkId).not.toBe(src.linkId);
  });

  it("refuses copies over the quota", async () => {
    const s = await member();
    const big = await file(s, (await list(s)).folder.id, [], "big.bin", "x".repeat(10));
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: 15n } });
    const res = await callRoute(transfer, { method: "POST", cookie: s.cookie, body: { ids: [big], targetId: "root", mode: "copy" } });
    expect(res.status).toBe(507);
  });
});

describe("delete", () => {
  it("removes items from the database and moves them to the trash", async () => {
    const s = await member();
    const gone = await folder(s, "root", "Gone");
    await file(s, gone.id, ["Gone"], "f.txt");
    const res = await callRoute<{ deleted: number }>(remove, { method: "POST", cookie: s.cookie, body: { ids: [gone.id] } });
    expect(res.json.data.deleted).toBe(1);
    expect(await prisma.node.count({ where: { accountId: s.id } })).toBe(1);
    expect(await readdir(s.root)).toEqual([]);
    const other = await member();
    expect((await callRoute(remove, { method: "POST", cookie: other.cookie, body: { ids: [gone.id] } })).status).toBe(404);
  });
});

describe("tags, settings and links", () => {
  it("adds and removes normalized tags on several items", async () => {
    const s = await member();
    const a = await folder(s, "root", "A");
    const b = await folder(s, "root", "B");
    await callRoute(tags, { method: "POST", cookie: s.cookie, body: { ids: [a.id, b.id], add: ["#Road Trip", "2024"] } });
    await callRoute(tags, { method: "POST", cookie: s.cookie, body: { ids: [b.id], remove: ["2024"] } });
    const root = await list(s);
    expect(root.children.find((c) => c.id === a.id)?.tags).toEqual(["road-trip", "2024"]);
    expect(root.children.find((c) => c.id === b.id)?.tags).toEqual(["road-trip"]);
  });

  it("saves settings; only admins set expiry; passwords are hashed", async () => {
    const s = await member();
    const a = await folder(s, "root", "Share");
    const inner = await folder(s, a.id, "Inner");
    await prisma.node.update({ where: { id: inner.id }, data: { visibility: "PRIVATE" } });
    const body = { visibility: "public", expiry: "1 day", burn: true, downloadLimit: 5, password: "secret", access: "stream", note: " hi ", applyDown: true };
    const saved = await callRoute<NodeItem, { id: string }>(settings, { method: "PUT", cookie: s.cookie, params: { id: a.id }, body });
    expect(saved.json.data.settings).toMatchObject({ visibility: "public", expiry: "Never", expAt: null, burn: false, downloadLimit: 5, hasPassword: true, access: "stream", note: "hi" });
    const row = await prisma.node.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.passwordHash).toMatch(/^\$argon2/);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: inner.id } })).visibility).toBe("INHERIT");

    const boss = await admin();
    const f = await folder(boss, "root", "Timed");
    const timed = await callRoute<NodeItem, { id: string }>(settings, { method: "PUT", cookie: boss.cookie, params: { id: f.id }, body: { ...body, password: "" } });
    expect(timed.json.data.settings).toMatchObject({ expiry: "1 day", burn: true, hasPassword: false });
    expect(Date.parse(timed.json.data.settings.expAt!) - Date.now()).toBeGreaterThan(86_000_000);
  });

  it("replaces links, logs the reset and limits pausing to admins", async () => {
    const s = await member();
    const a = await folder(s, "root", "Linked");
    const replaced = await callRoute<NodeItem, { id: string }>(newLink, { method: "POST", cookie: s.cookie, params: { id: a.id } });
    expect(replaced.json.data.linkId).not.toBe(a.linkId);
    const log = await callRoute<LinkEventDto[], { id: string }>(activity, { cookie: s.cookie, params: { id: a.id } });
    expect(log.json.data.map((e) => e.kind)).toEqual(["reset"]);
    expect((await callRoute(pause, { method: "PUT", cookie: s.cookie, params: { id: a.id }, body: { paused: true } })).status).toBe(403);

    const boss = await admin();
    const f = await folder(boss, "root", "Hot");
    const paused = await callRoute<NodeItem, { id: string }>(pause, { method: "PUT", cookie: boss.cookie, params: { id: f.id }, body: { paused: true } });
    expect(paused.json.data.settings.dlPaused).toBe(true);
  });
});

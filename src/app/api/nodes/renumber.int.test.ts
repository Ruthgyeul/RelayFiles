import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { GET as getFolder } from "@/app/api/folders/[id]/route";
import { POST as createFolder } from "@/app/api/folders/route";
import { GET as preview, POST as apply } from "@/app/api/nodes/[id]/renumber/route";
import type { CreatedAccount } from "@/contracts/auth";
import type { CreatedFolder, FolderView, RenumberPreview, RenumberResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { LocalVolumeDriver } from "@/server/storage/local-volume";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { randomTestIp } from "../../../../test/file-fixtures";
import { callRoute } from "../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];

async function member() {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  const id = res.json.data.account.id;
  accounts.push(id);
  return { id, cookie: res.cookie!, root: userRootOf(configuredVolumeRoot(), id) };
}
type Session = Awaited<ReturnType<typeof member>>;

const rootOf = async (s: Session) => (await callRoute<FolderView, { id: string }>(getFolder, { cookie: s.cookie, params: { id: "root" } })).json.data.folder.id;
const folder = async (s: Session, parentId: string, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: s.cookie, body: { parentId, name } })).json.data.folder;

/** A file row with its bytes on disk, created `minutesAgo` and last modified `modifiedMinutesAgo`. */
async function file(s: Session, parentId: string, segments: string[], name: string, minutesAgo: number, modifiedMinutesAgo: number | null = null) {
  const id = newNodeId();
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  await prisma.node.create({
    data: { id, accountId: s.id, parentId, type: "FILE", kind: "IMAGE", name, size: BigInt(name.length), linkId: newLinkId(), tags: [`t-${name}`], createdAt: at(minutesAgo), modifiedAt: modifiedMinutesAgo === null ? null : at(modifiedMinutesAgo) },
  });
  await writeFile(join(s.root, ...segments, name), `bytes of ${name}`);
  return id;
}

const plan = async (s: Session, id: string, sort: string, order = "asc") => callRoute<RenumberPreview, { id: string }>(preview, { cookie: s.cookie, params: { id }, query: `?sort=${sort}&order=${order}` });
const run = async (s: Session, id: string, sort: string, expect: { id: string; to: string }[], order = "asc") =>
  callRoute<RenumberResult, { id: string }>(apply, { method: "POST", cookie: s.cookie, params: { id }, body: { sort, order, expect } });
const reviewed = (p: RenumberPreview) => p.entries.map(({ id, to }) => ({ id, to }));

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("renumber files", () => {
  it("renames files to 01, 02, … by creation time, swapping names safely and keeping ids, tags and links", async () => {
    const s = await member();
    const root = await rootOf(s);
    const album = await folder(s, root, "Album");
    const a = await file(s, album.id, ["Album"], "02.jpg", 30);
    const b = await file(s, album.id, ["Album"], "01.jpg", 20);
    const c = await file(s, album.id, ["Album"], "zz.PNG", 10);
    await file(s, album.id, ["Album"], ".hidden", 5);
    await folder(s, album.id, "Sub");
    const before = await prisma.node.findMany({ where: { parentId: album.id }, select: { id: true, linkId: true, tags: true } });

    const previewed = (await plan(s, album.id, "created")).json.data;
    expect(previewed.entries.map((entry) => [entry.id, entry.from, entry.to])).toEqual([
      [a, "02.jpg", "01.jpg"],
      [b, "01.jpg", "02.jpg"],
      [c, "zz.PNG", "03.PNG"],
    ]);
    expect(previewed).toMatchObject({ changes: 3, conflict: null, skipped: [{ name: ".hidden", reason: "hidden" }] });

    const done = await run(s, album.id, "created", reviewed(previewed));
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json.data).toEqual({ renamed: 3, unchanged: 0 });
    expect(await readFile(join(s.root, "Album", "01.jpg"), "utf8")).toBe("bytes of 02.jpg");
    expect(await readFile(join(s.root, "Album", "02.jpg"), "utf8")).toBe("bytes of 01.jpg");
    expect(await readFile(join(s.root, "Album", "03.PNG"), "utf8")).toBe("bytes of zz.PNG");
    expect((await readdir(join(s.root, "Album"))).sort()).toEqual([".hidden", "01.jpg", "02.jpg", "03.PNG", "Sub"]);
    expect(await prisma.node.findMany({ where: { parentId: album.id }, select: { id: true, linkId: true, tags: true } })).toEqual(expect.arrayContaining(before));

    // Running the same order again changes nothing.
    const again = (await plan(s, album.id, "created")).json.data;
    expect(again.changes).toBe(0);
    expect((await run(s, album.id, "created", reviewed(again))).json.data).toEqual({ renamed: 0, unchanged: 3 });
  });

  it("orders by name or by the file's own modification time", async () => {
    const s = await member();
    const root = await rootOf(s);
    await file(s, root, [], "b10.jpg", 3, 100);
    await file(s, root, [], "b2.jpg", 2, null);
    await file(s, root, [], "a.jpg", 1, 50);
    expect((await plan(s, "root", "name")).json.data.entries.map((entry) => entry.from)).toEqual(["a.jpg", "b2.jpg", "b10.jpg"]);
    expect((await plan(s, "root", "modified")).json.data.entries.map((entry) => entry.from)).toEqual(["b10.jpg", "a.jpg", "b2.jpg"]);
    expect((await plan(s, "root", "modified", "desc")).json.data.entries.map((entry) => entry.from)).toEqual(["b2.jpg", "a.jpg", "b10.jpg"]);
  });

  it("refuses a plan that no longer matches the folder", async () => {
    const s = await member();
    const root = await rootOf(s);
    await file(s, root, [], "x.jpg", 2);
    const previewed = (await plan(s, root, "name")).json.data;
    await file(s, root, [], "a.jpg", 1);
    const stale = await run(s, root, "name", reviewed(previewed));
    expect(stale.status).toBe(409);
    expect(stale.json.error).toContain("This folder changed");
    expect((await readdir(s.root)).sort()).toEqual(["a.jpg", "x.jpg"]);
  });

  it("refuses names taken by a folder that keeps its name", async () => {
    const s = await member();
    const root = await rootOf(s);
    await folder(s, root, "01.jpg");
    await file(s, root, [], "x.jpg", 1);
    const previewed = (await plan(s, root, "name")).json.data;
    expect(previewed.conflict).toContain('"01.jpg"');
    expect((await run(s, root, "name", reviewed(previewed))).status).toBe(409);
  });

  it("puts every name back when a rename fails half way", async () => {
    const s = await member();
    const root = await rootOf(s);
    const ids = [await file(s, root, [], "c.jpg", 3), await file(s, root, [], "a.jpg", 2), await file(s, root, [], "b.jpg", 1)];
    const previewed = (await plan(s, root, "created")).json.data;
    const real = LocalVolumeDriver.prototype.renameNoReplace;
    let calls = 0;
    // Fail the fifth rename: three files have temporary names, one already has its number.
    const spy = vi.spyOn(LocalVolumeDriver.prototype, "renameNoReplace").mockImplementation(function (this: LocalVolumeDriver, from, to) {
      calls += 1;
      if (calls === 5) return Promise.reject(new Error("disk went away"));
      return real.call(this, from, to);
    });
    try {
      expect((await run(s, root, "created", reviewed(previewed))).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await readdir(s.root)).sort()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(await readFile(join(s.root, "c.jpg"), "utf8")).toBe("bytes of c.jpg");
    const rows = await prisma.node.findMany({ where: { id: { in: ids } }, select: { name: true } });
    expect(rows.map((row) => row.name).sort()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("hides other accounts' folders", async () => {
    const s = await member();
    const other = await member();
    const root = await rootOf(s);
    expect((await plan(other, root, "name")).status).toBe(404);
    expect((await run(other, root, "name", [])).status).toBe(404);
  });
});

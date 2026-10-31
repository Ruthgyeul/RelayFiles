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
import { getEnv } from "@/config/env";
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
const run = async (s: Session, id: string, sort: string, expect: { id: string; to: string }[], count?: number, order = "asc") =>
  callRoute<RenumberResult, { id: string }>(apply, { method: "POST", cookie: s.cookie, params: { id }, body: { sort, order, expect, ...(count === undefined ? {} : { count }) } });
/** The whole reviewed plan (the request format of the first release, still accepted). */
const reviewed = (p: RenumberPreview) => p.entries.map(({ id, to }) => ({ id, to }));
/** Only the files whose name changes, as the dialog sends them. */
const changes = (p: RenumberPreview) => p.entries.filter((entry) => entry.from !== entry.to).map(({ id, to }) => ({ id, to }));

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

  it("orders by the date taken, placing files without one by their modification time", async () => {
    const s = await member();
    const root = await rootOf(s);
    const late = await file(s, root, [], "late.jpg", 3, 10);
    const early = await file(s, root, [], "early.jpg", 2, 1);
    const none = await file(s, root, [], "none.jpg", 1, 5);
    await prisma.node.update({ where: { id: late }, data: { takenAt: new Date("2024-01-02T00:00:00Z") } });
    await prisma.node.update({ where: { id: early }, data: { takenAt: new Date("2023-01-02T00:00:00Z") } });
    const previewed = (await plan(s, root, "taken")).json.data;
    expect(previewed.entries.map((entry) => entry.id)).toEqual([early, late, none]);
    expect(previewed.takenFallbacks).toBe(1);
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

  it("renumbers a large folder that was mostly numbered already, with no file limit", async () => {
    const s = await member();
    const root = await rootOf(s);
    const big = await folder(s, root, "Big");
    const count = 2_500;
    const numbered = Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(4, "0")}.jpg`);
    await prisma.node.createMany({
      data: numbered.map((name, i) => ({ id: newNodeId(), accountId: s.id, parentId: big.id, type: "FILE" as const, kind: "IMAGE" as const, name, size: 1n, linkId: newLinkId(), createdAt: new Date(Date.now() - (count - i) * 1_000) })),
    });
    await Promise.all(numbered.map((name) => writeFile(join(s.root, "Big", name), "x")));
    const added = await file(s, big.id, ["Big"], "new.jpg", 0);

    // Already numbered by name: only the new file changes, but the folder holds more than 2,000 files.
    const byName = (await plan(s, big.id, "name")).json.data;
    expect(byName).toMatchObject({ changes: 1, conflict: null });
    const once = await run(s, big.id, "name", changes(byName), byName.entries.length);
    expect(once.status, JSON.stringify(once.json)).toBe(200);
    expect(once.json.data).toEqual({ renamed: 1, unchanged: count });
    expect((await prisma.node.findUniqueOrThrow({ where: { id: added } })).name).toBe("2501.jpg");

    // Newest first renames every file but the one in the middle: well past the old 2,000 limit.
    const reversed = (await plan(s, big.id, "created", "desc")).json.data;
    expect(reversed).toMatchObject({ changes: count, conflict: null });
    const all = await run(s, big.id, "created", changes(reversed), reversed.entries.length, "desc");
    expect(all.status, JSON.stringify(all.json)).toBe(200);
    expect(all.json.data).toEqual({ renamed: count, unchanged: 1 });
    expect((await prisma.node.findUniqueOrThrow({ where: { id: added } })).name).toBe("0001.jpg");
    expect(await readFile(join(s.root, "Big", "0001.jpg"), "utf8")).toBe("bytes of new.jpg");
    expect((await readdir(join(s.root, "Big"))).length).toBe(count + 1);
  }, 120_000);

  it("refuses more changes than RENUMBER_MAX_FILES allows", async () => {
    const policy = getEnv("policy") as { RENUMBER_MAX_FILES: number };
    const saved = policy.RENUMBER_MAX_FILES;
    policy.RENUMBER_MAX_FILES = 2;
    try {
      const s = await member();
      const root = await rootOf(s);
      for (const [index, name] of ["c.jpg", "b.jpg", "a.jpg"].entries()) await file(s, root, [], name, index + 1);
      const previewed = (await plan(s, root, "name")).json.data;
      expect(previewed.conflict).toBe("3 files would be renamed. Renumber at most 2 at a time.");
      const refused = await run(s, root, "name", changes(previewed), previewed.entries.length);
      expect(refused.status).toBe(400);
      expect(refused.json.error).toBe("3 files would be renamed. Renumber at most 2 at a time.");
      expect((await readdir(s.root)).sort()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    } finally {
      policy.RENUMBER_MAX_FILES = saved;
    }
  });

  it("refuses the reviewed changes when a file was added meanwhile", async () => {
    const s = await member();
    const root = await rootOf(s);
    await file(s, root, [], "01.jpg", 3);
    await file(s, root, [], "b.jpg", 2);
    const previewed = (await plan(s, root, "created")).json.data;
    await file(s, root, [], "zz.jpg", 1);
    const stale = await run(s, root, "created", changes(previewed), previewed.entries.length);
    expect(stale.status).toBe(409);
  });

  it("hides other accounts' folders", async () => {
    const s = await member();
    const other = await member();
    const root = await rootOf(s);
    expect((await plan(other, root, "name")).status).toBe(404);
    expect((await run(other, root, "name", [])).status).toBe(404);
  });
});

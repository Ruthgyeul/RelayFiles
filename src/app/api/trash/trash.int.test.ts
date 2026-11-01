import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createFolder } from "@/app/api/folders/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { DELETE as deleteForever } from "@/app/api/trash/[id]/route";
import { POST as restore } from "@/app/api/trash/[id]/restore/route";
import { GET as listTrash } from "@/app/api/trash/route";
import { FILES, MS, STORAGE } from "@/config/policy";
import type { CreatedFolder } from "@/contracts/nodes";
import type { DeletedItemDto, RestoredItem } from "@/contracts/trash";
import { forgetDeletedBefore } from "@/server/repositories/deleted-item.repo";
import { forgetTrashedBefore } from "@/server/repositories/trash.repo";
import { purgeExpired } from "@/server/services/profile.service";
import { moveAccountToVolume } from "@/server/services/storage-migration.service";
import { layoutOf } from "@/server/storage/layout";
import { initVolume } from "@/server/storage/volume";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();
const volumes: { id: string; root: string }[] = [];

afterAll(async () => {
  await cleanup();
  for (const volume of volumes) {
    await prisma.account.deleteMany({ where: { volumeId: volume.id } });
    await prisma.storageVolume.delete({ where: { id: volume.id } });
    await rm(volume.root, { recursive: true, force: true });
  }
});

const folder = async (m: FixtureMember, parentId: string, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: m.cookie, body: { parentId, name } })).json.data.folder.id;
const del = (m: FixtureMember, ids: string[]) => callRoute<{ deleted: number }>(remove, { method: "POST", cookie: m.cookie, body: { ids } });
const list = async (m: FixtureMember) => (await callRoute<DeletedItemDto[]>(listTrash, { cookie: m.cookie })).json.data;
const restoreItem = (m: FixtureMember, id: string) => callRoute<RestoredItem, { id: string }>(restore, { method: "POST", cookie: m.cookie, params: { id } });
const forget = (m: FixtureMember, id: string) => callRoute<{ deleted: true }, { id: string }>(deleteForever, { method: "DELETE", cookie: m.cookie, params: { id } });

/** Bytes counted toward the quota: files plus bytes waiting in the trash. */
async function counted(m: FixtureMember): Promise<bigint> {
  const files = await prisma.node.aggregate({ where: { accountId: m.id, type: "FILE" }, _sum: { size: true } });
  const trashed = await prisma.trashedBytes.aggregate({ where: { accountId: m.id }, _sum: { bytes: true } });
  return (files._sum.size ?? 0n) + (trashed._sum.bytes ?? 0n);
}

/** The columns a restore must bring back as they were. */
const kept = (rows: { id: string; parentId: string | null; name: string; linkId: string; tags: string[]; visibility: string; note: string; downloads: number; passwordHash: string | null; size: bigint; createdAt: Date; modifiedAt: Date | null }[]) =>
  rows
    .map(({ id, parentId, name, linkId, tags, visibility, note, downloads, passwordHash, size, createdAt, modifiedAt }) => ({ id, parentId, name, linkId, tags, visibility, note, downloads, passwordHash, size, createdAt, modifiedAt }))
    .sort((a, b) => a.id.localeCompare(b.id));

describe("recently deleted", () => {
  it("restores a folder with the same ids, links, settings, tags and bytes, and the quota counts the same", async () => {
    const m = await member();
    const trip = await folder(m, "root", "Trip");
    const sub = await folder(m, trip, "Sub");
    await addFile(m, trip, ["Trip"], "a.txt", "hello", "text/plain");
    await addFile(m, sub, ["Trip", "Sub"], "b.bin", "x".repeat(7), "application/octet-stream");
    await prisma.node.update({ where: { id: trip }, data: { tags: ["holiday"], visibility: "PUBLIC", note: "See you", downloads: 3, passwordHash: "hash", hasThumb: true } });
    const before = kept(await prisma.node.findMany({ where: { accountId: m.id, parentId: { not: null } } }));
    const quota = await counted(m);

    expect((await del(m, [trip])).json.data).toEqual({ deleted: 1 });
    expect(await prisma.node.count({ where: { accountId: m.id } })).toBe(1);
    expect(await counted(m)).toBe(quota);
    const [item, ...rest] = await list(m);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ name: "Trip", type: "folder", kind: null, size: "12", itemCount: 4, location: ["root"] });
    expect(new Date(item!.expiresAt).getTime() - new Date(item!.deletedAt).getTime()).toBe(STORAGE.trashRetentionHours * MS.hour);

    const res = await restoreItem(m, item!.id);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ name: "Trip", renamed: false, folderName: "root", folderIsRoot: true, inOriginalFolder: true });
    expect(kept(await prisma.node.findMany({ where: { accountId: m.id, parentId: { not: null } } }))).toEqual(before);
    // Generated files are made again from scratch.
    expect((await prisma.node.findUniqueOrThrow({ where: { id: trip } })).hasThumb).toBe(false);
    expect(await readFile(join(m.dir, "Trip", "a.txt"), "utf8")).toBe("hello");
    expect(await readFile(join(m.dir, "Trip", "Sub", "b.bin"), "utf8")).toBe("x".repeat(7));
    expect(await counted(m)).toBe(quota);
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(0);
    expect(await list(m)).toEqual([]);
    // Restored once: a second try finds nothing.
    expect((await restoreItem(m, item!.id)).status).toBe(404);
  });

  it("keeps one entry per deleted item, each with its own bytes", async () => {
    const m = await member();
    await addFile(m, m.rootId, [], "one.txt", "1", "text/plain");
    const two = await addFile(m, m.rootId, [], "two.txt", "22", "text/plain");
    const one = (await prisma.node.findFirstOrThrow({ where: { accountId: m.id, name: "one.txt" } })).id;
    await del(m, [one, two]);
    const items = await list(m);
    expect(items.map((entry) => [entry.name, entry.size, entry.type]).sort()).toEqual([
      ["one.txt", "1", "file"],
      ["two.txt", "2", "file"],
    ]);
    const restored = await restoreItem(m, items.find((entry) => entry.name === "two.txt")!.id);
    expect(restored.status).toBe(200);
    // Only the restored item's bytes left the trash.
    expect((await prisma.trashedBytes.aggregate({ where: { accountId: m.id }, _sum: { bytes: true } }))._sum.bytes).toBe(1n);
  });

  it("restores into the account root when the old folder was deleted, and into it once it is back", async () => {
    const m = await member();
    const docs = await folder(m, "root", "Docs");
    const note = await addFile(m, docs, ["Docs"], "note.txt", "n", "text/plain");
    const other = await folder(m, "root", "Other");
    const memo = await addFile(m, other, ["Other"], "memo.txt", "m", "text/plain");
    for (const id of [note, docs, memo, other]) await del(m, [id]);
    const items = await list(m);
    expect(items.map((entry) => [entry.name, entry.location])).toEqual([
      ["Other", ["root"]],
      ["memo.txt", ["root", "Other"]],
      ["Docs", ["root"]],
      ["note.txt", ["root", "Docs"]],
    ]);
    const entry = (name: string) => items.find((item) => item.name === name)!.id;

    const fallback = await restoreItem(m, entry("memo.txt"));
    expect(fallback.json.data).toMatchObject({ name: "memo.txt", folderId: m.rootId, folderIsRoot: true, inOriginalFolder: false });
    expect(await readFile(join(m.dir, "memo.txt"), "utf8")).toBe("m");

    // A restored folder keeps its id, so what was deleted from it goes back into it.
    await restoreItem(m, entry("Docs"));
    const back = await restoreItem(m, entry("note.txt"));
    expect(back.json.data).toMatchObject({ folderId: docs, folderName: "Docs", folderIsRoot: false, inOriginalFolder: true });
    await stat(join(m.dir, "Docs", "note.txt"));
  });

  it("names the item \"Name (2)\" when its name was taken meanwhile", async () => {
    const m = await member();
    const first = await addFile(m, m.rootId, [], "n.txt", "old", "text/plain");
    await del(m, [first]);
    await addFile(m, m.rootId, [], "n.txt", "new", "text/plain");
    const res = await restoreItem(m, (await list(m))[0]!.id);
    expect(res.json.data).toMatchObject({ name: "n (2).txt", renamed: true });
    expect(await readFile(join(m.dir, "n (2).txt"), "utf8")).toBe("old");
    expect(await readFile(join(m.dir, "n.txt"), "utf8")).toBe("new");
  });

  it("answers 404 for another account's items", async () => {
    const owner = await member();
    const file = await addFile(owner, owner.rootId, [], "mine.txt", "m", "text/plain");
    await del(owner, [file]);
    const [item] = await list(owner);
    const other = await member();
    expect(await list(other)).toEqual([]);
    expect((await restoreItem(other, item!.id)).status).toBe(404);
    expect((await forget(other, item!.id)).status).toBe(404);
    expect((await restoreItem(other, "abcdefghjkmn")).status).toBe(404);
    expect((await restoreItem(other, "../x")).status).toBe(400);
    expect(await list(owner)).toHaveLength(1);
  });

  it("deletes forever: the trash entry, its bytes and the entry go", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "gone.txt", "bye", "text/plain");
    await del(m, [file]);
    const [item] = await list(m);
    const row = await prisma.deletedItem.findUniqueOrThrow({ where: { id: item!.id } });
    await stat(row.trashPath);
    expect((await forget(m, item!.id)).status).toBe(200);
    await expect(stat(row.trashPath)).rejects.toThrow();
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(0);
    expect(await list(m)).toEqual([]);
    expect((await restoreItem(m, item!.id)).status).toBe(404);
  });

  it("answers 410 when the trash was emptied before its entry was forgotten", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "late.txt", "l", "text/plain");
    await del(m, [file]);
    const [item] = await list(m);
    await rm((await prisma.deletedItem.findUniqueOrThrow({ where: { id: item!.id } })).trashPath, { force: true });
    const res = await restoreItem(m, item!.id);
    expect([res.status, res.json.error]).toEqual([410, "This item was already removed for good."]);
    // Nothing was put back.
    expect(await prisma.node.count({ where: { id: file } })).toBe(0);
    expect(await list(m)).toHaveLength(1);
  });

  it("does not keep items the cleanup deletes because their link expired", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "expired.txt", "e", "text/plain");
    await prisma.node.update({ where: { id: file }, data: { expAt: new Date(Date.now() - MS.minute) } });
    const owner = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    expect(await purgeExpired(owner, new Date())).toEqual({ deleted: 1 });
    expect(await list(m)).toEqual([]);
    expect((await prisma.trashedBytes.aggregate({ where: { accountId: m.id }, _sum: { bytes: true } }))._sum.bytes).toBe(1n);
  });

  it("refuses a restore that would take the account past its item limit", async () => {
    const m = await member();
    const box = await folder(m, "root", "Box");
    await folder(m, box, "Inside");
    await folder(m, "root", "Stays");
    await del(m, [box]);
    // A small limit instead of filling the account with FILES.maxItemsPerAccount rows.
    const limits = FILES as { maxItemsPerAccount: number };
    const limit = limits.maxItemsPerAccount;
    limits.maxItemsPerAccount = 2;
    try {
      const res = await restoreItem(m, (await list(m))[0]!.id);
      expect([res.status, res.json.error]).toEqual([400, "An account can hold at most 2 files and folders."]);
      limits.maxItemsPerAccount = 3;
      expect((await restoreItem(m, (await list(m))[0]!.id)).status).toBe(200);
    } finally {
      limits.maxItemsPerAccount = limit;
    }
  });

  it("restores an item once when two restores (or a restore and a delete forever) race", async () => {
    const m = await member();
    const pics = await folder(m, "root", "Pics");
    await addFile(m, pics, ["Pics"], "p.txt", "p", "text/plain");
    await del(m, [pics]);
    const [item] = await list(m);
    const results = await Promise.all([restoreItem(m, item!.id), restoreItem(m, item!.id), forget(m, item!.id)]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 404)).toHaveLength(2);
    const restored = results[0]!.status === 200 || results[1]!.status === 200;
    expect(await prisma.node.count({ where: { accountId: m.id, name: "Pics" } })).toBe(restored ? 1 : 0);
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(0);
    if (restored) expect(await readFile(join(m.dir, "Pics", "p.txt"), "utf8")).toBe("p");
  });

  it("restores a deleted folder and a file deleted from it at the same time, each exactly once", async () => {
    const m = await member();
    const box = await folder(m, "root", "Box");
    const inner = await addFile(m, box, ["Box"], "in.txt", "i", "text/plain");
    await del(m, [inner]);
    await del(m, [box]);
    const items = await list(m);
    const results = await Promise.all(items.map((entry) => restoreItem(m, entry.id)));
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const file = await prisma.node.findUniqueOrThrow({ where: { id: inner } });
    // Into Box when its restore committed first, else into the root.
    const where = file.parentId === box ? ["Box", "in.txt"] : ["in.txt"];
    expect(await readFile(join(m.dir, ...where), "utf8")).toBe("i");
    expect(await counted(m)).toBe(1n);
  });
});

describe("cleanup and volumes", () => {
  it("forgets expired entries only on volumes whose trash was emptied", async () => {
    const m = await member();
    const old = await addFile(m, m.rootId, [], "old.txt", "o", "text/plain");
    const fresh = await addFile(m, m.rootId, [], "fresh.txt", "f", "text/plain");
    await del(m, [old]);
    await del(m, [fresh]);
    const deletedAt = new Date(Date.now() - (STORAGE.trashRetentionHours + 1) * MS.hour);
    await prisma.deletedItem.updateMany({ where: { accountId: m.id, name: "old.txt" }, data: { deletedAt } });
    const cutoff = new Date(Date.now() - STORAGE.trashRetentionHours * MS.hour);
    const { volumeId } = await prisma.account.findUniqueOrThrow({ where: { id: m.id }, select: { volumeId: true } });

    expect(await forgetDeletedBefore(prisma, cutoff, ["some-other-volume"])).toBe(0);
    expect(await forgetDeletedBefore(prisma, cutoff, [])).toBe(0);
    expect((await list(m)).map((entry) => entry.name).sort()).toEqual(["fresh.txt", "old.txt"]);
    await forgetDeletedBefore(prisma, cutoff, [volumeId]);
    expect((await list(m)).map((entry) => entry.name)).toEqual(["fresh.txt"]);
  });

  it("refuses with 409 once the account moved to another volume, and goes with the account", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "before-move.txt", "b", "text/plain");
    await del(m, [file]);
    const [item] = await list(m);
    const root = await mkdtemp(join(tmpdir(), "relay-volume-"));
    const id = randomUUID();
    await initVolume(root, id);
    await prisma.storageVolume.create({ data: { id, mountPath: root, status: "ACTIVE" } });
    volumes.push({ id, root });
    await moveAccountToVolume(m.id, id);

    const res = await restoreItem(m, item!.id);
    expect([res.status, res.json.code]).toEqual([409, "CONFLICT"]);
    expect(res.json.error).toMatch(/moved to new storage/);
    expect((await forget(m, item!.id)).status).toBe(409);
    // Its bytes are still in the old volume's trash and keep counting until that is emptied.
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(1);
    const old = (await prisma.deletedItem.findUniqueOrThrow({ where: { id: item!.id } })).volumeId;
    await forgetTrashedBefore(prisma, new Date(Date.now() + MS.second), [id]);
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(1);
    expect(old).not.toBe(id);

    await prisma.account.delete({ where: { id: m.id } });
    expect(await prisma.deletedItem.count({ where: { accountId: m.id } })).toBe(0);
    // Leave no trash of this test on the shared volume.
    const trash = layoutOf((await prisma.storageVolume.findUniqueOrThrow({ where: { id: old } })).mountPath).trash;
    for (const name of (await readdir(trash)).filter((entry) => entry.includes(m.id))) await rm(join(trash, name), { recursive: true, force: true });
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { POST as createFolder } from "@/app/api/folders/route";
import { AUTO_CLEAN, MS } from "@/config/policy";
import type { AutoCleanView } from "@/contracts/auto-clean";
import type { CreatedFolder } from "@/contracts/nodes";
import { runAutoClean } from "@/server/services/auto-clean.service";
import { callRoute } from "../../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../../test/file-fixtures";
import { DELETE, GET, PUT } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();
afterAll(cleanup);

const folder = async (m: FixtureMember, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: m.rootId, name } })).json.data.folder.id;
const view = (m: FixtureMember, id: string, query = "") => callRoute<AutoCleanView, { id: string }>(GET, { cookie: m.cookie, params: { id }, query });
const save = (m: FixtureMember, id: string, body: unknown) => callRoute<AutoCleanView, { id: string }>(PUT, { method: "PUT", cookie: m.cookie, params: { id }, body });
const remove = (m: FixtureMember, id: string) => callRoute<{ removed: true }, { id: string }>(DELETE, { method: "DELETE", cookie: m.cookie, params: { id } });
const ago = (days: number) => new Date(Date.now() - days * MS.day);
/** Names in a folder in code point order (the database's collation differs between machines). */
const names = async (parentId: string) => (await prisma.node.findMany({ where: { parentId }, select: { name: true } })).map((row) => row.name).sort();

/** A file at `segments` (the folder's path on disk) dated `days` ago (date added, or date modified with `modified`). */
async function oldFile(m: FixtureMember, folderId: string, segments: string | string[], name: string, days: number, modified = false) {
  const id = await addFile(m, folderId, typeof segments === "string" ? [segments] : segments, name, name, "text/plain");
  await prisma.node.update({ where: { id }, data: modified ? { modifiedAt: ago(days) } : { createdAt: ago(days) } });
  return id;
}

describe("folder auto-clean rules", () => {
  it("saves, previews and removes a rule, refusing the root and other accounts' folders", async () => {
    const m = await member();
    const other = await member();
    const id = await folder(m, "Downloads");
    await oldFile(m, id, "Downloads", "old.txt", 40);
    await oldFile(m, id, "Downloads", "new.txt", 2);

    expect((await view(m, id)).json.data).toEqual({ rule: null, due: 0 });
    expect((await view(m, id, "?days=30&basis=created")).json.data).toEqual({ rule: null, due: 1 });
    expect((await view(m, id, "?days=1&basis=created")).json.data.due).toBe(2);

    const saved = await save(m, id, { olderThanDays: 30, basis: "created" });
    expect(saved.json.data).toEqual({ rule: { olderThanDays: 30, basis: "created" }, due: 1 });
    expect((await view(m, id)).json.data).toEqual({ rule: { olderThanDays: 30, basis: "created" }, due: 1 });

    expect((await save(m, "root", { olderThanDays: 30, basis: "created" })).status).toBe(400);
    expect((await save(m, id, { olderThanDays: 0, basis: "created" })).status).toBe(400);
    expect((await save(m, id, { olderThanDays: AUTO_CLEAN.maxDays + 1, basis: "created" })).status).toBe(400);
    expect((await view(other, id)).status).toBe(404);
    expect((await save(other, id, { olderThanDays: 1, basis: "created" })).status).toBe(404);
    expect((await remove(other, id)).status).toBe(404);

    expect((await remove(m, id)).status).toBe(200);
    expect((await view(m, id)).json.data.rule).toBeNull();
  });

  it("moves only old files directly in the folder to Recently deleted, by the chosen date", async () => {
    const m = await member();
    const other = await member();
    const byAdded = await folder(m, "Inbox");
    const byModified = await folder(m, "Scans");
    const sub = (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: byAdded, name: "Keep" } })).json.data.folder.id;
    await oldFile(m, byAdded, "Inbox", "a-old.txt", 10);
    await oldFile(m, byAdded, "Inbox", "b-new.txt", 1);
    await oldFile(m, sub, ["Inbox", "Keep"], "deep-old.txt", 10);
    // Added long ago but changed recently: a "modified" rule keeps it.
    const recent = await oldFile(m, byModified, "Scans", "recent.txt", 1, true);
    await prisma.node.update({ where: { id: recent }, data: { createdAt: ago(100) } });
    await oldFile(m, byModified, "Scans", "stale.txt", 10, true);
    // Another account's old file in a folder with the same name and no rule.
    const theirs = await folder(other, "Inbox");
    await oldFile(other, theirs, "Inbox", "a-old.txt", 10);

    await save(m, byAdded, { olderThanDays: 7, basis: "created" });
    await save(m, byModified, { olderThanDays: 7, basis: "modified" });
    const result = await runAutoClean(new Date());
    expect(result.files).toBeGreaterThanOrEqual(2);

    expect(await names(byAdded)).toEqual(["Keep", "b-new.txt"]);
    // Folders inside are left alone, with what they hold.
    expect(await names(sub)).toEqual(["deep-old.txt"]);
    expect(await names(byModified)).toEqual(["recent.txt"]);
    expect(await names(theirs)).toEqual(["a-old.txt"]);
    // Restorable: each moved file waits under Recently deleted.
    const deleted = await prisma.deletedItem.findMany({ where: { accountId: m.id }, select: { name: true } });
    expect(deleted.map((row) => row.name).sort()).toEqual(["a-old.txt", "stale.txt"]);
  });

  it("moves at most the per-run limit, and the rest on the next run", async () => {
    const m = await member();
    const id = await folder(m, "Many");
    for (const name of ["1.txt", "2.txt", "3.txt"]) await oldFile(m, id, "Many", name, 30);
    await save(m, id, { olderThanDays: 7, basis: "created" });
    await runAutoClean(new Date(), 2);
    expect(await names(id)).toHaveLength(1);
    await runAutoClean(new Date(), 2);
    expect(await names(id)).toEqual([]);
  });
});

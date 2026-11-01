import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import { afterAll, describe, expect, it } from "vitest";
import { newLinkId, newNodeId } from "@/domain/ids";
import { findAccountById } from "@/server/repositories/account.repo";
import { closeQueues } from "@/server/jobs/queue";
import type { Unlocks } from "@/server/share/unlock-cookie";
import { countQueries } from "../../../test/query-counter";
import { fileFixtures, type FixtureMember } from "../../../test/file-fixtures";

// Before fileFixtures(), which takes the shared client.
const { measure } = countQueries();
const { prisma, member, cleanup } = fileFixtures();
const { getFolderView } = await import("./node.service");
const { deleteItems, topLevel } = await import("./node-ops.service");
const { copyNodes, moveNodes } = await import("./transfer.service");
const { zipItems } = await import("./zip.service");
const { sharePage } = await import("../share/share.service");

const noViewer = { accountIds: [], unlocks: new Map() as Unlocks, visitorId: null };

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

/** Building the large trees takes a while. */
const SLOW = 120_000;

/** Prints what an operation cost, for the numbers in the commit and docs. */
const report = (label: string, small: { queries: number; ms: number }, large: { queries: number; ms: number }) =>
  console.warn(`[tree-queries] ${label}: small ${small.queries} queries ${small.ms}ms, large ${large.queries} queries ${large.ms}ms`);

type Row = { id: string; linkId: string };

async function folderRow(m: FixtureMember, parentId: string, name: string, data: Record<string, unknown> = {}): Promise<Row> {
  const row = { id: newNodeId(), linkId: newLinkId() };
  await prisma.node.create({ data: { ...row, accountId: m.id, parentId, type: "FOLDER", name, ...data } });
  return row;
}

/** `count` files named `<prefix>-<n>.txt` with `<n>` bytes of content, in the database (and on disk with `segments`). */
async function filesIn(m: FixtureMember, parentId: string, segments: string[] | null, count: number, prefix = "f", data: Record<string, unknown> = {}): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, index) => {
    const name = `${prefix}-${index + 1}.txt`;
    const bytes = Buffer.alloc(index + 1, "x");
    return { id: newNodeId(), linkId: newLinkId(), accountId: m.id, parentId, type: "FILE" as const, kind: "OTHER" as const, mime: "text/plain", name, size: BigInt(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex"), bytes, ...data };
  });
  if (segments) {
    await mkdir(join(m.dir, ...segments), { recursive: true });
    await Promise.all(rows.map((row) => writeFile(join(m.dir, ...segments, row.name), row.bytes)));
  }
  await prisma.node.createMany({ data: rows.map(({ bytes: _bytes, ...row }) => row) });
  return rows.map((row) => row.id);
}

/** Bytes of files named by filesIn: 1 + 2 + … + count. */
const bytesOf = (count: number) => (count * (count + 1)) / 2;

/**
 * A folder (database rows only) with `folders` subfolders of `perFolder` files each, one nested
 * folder of 2 files in each, and 3 files of its own.
 */
async function tree(m: FixtureMember, name: string, folders: number, perFolder: number, data: Record<string, unknown> = {}) {
  const top = await folderRow(m, m.rootId, name, data);
  const subs = Array.from({ length: folders }, (_, index) => ({ id: newNodeId(), linkId: newLinkId(), accountId: m.id, parentId: top.id, type: "FOLDER" as const, name: `d${index}` }));
  const deeps = subs.map((sub) => ({ id: newNodeId(), linkId: newLinkId(), accountId: m.id, parentId: sub.id, type: "FOLDER" as const, name: "deep" }));
  await prisma.node.createMany({ data: [...subs, ...deeps] });
  for (const [index, sub] of subs.entries()) {
    await filesIn(m, sub.id, null, perFolder);
    await filesIn(m, deeps[index]!.id, null, 2);
  }
  await filesIn(m, top.id, null, 3, "top");
  return top;
}

describe("folder view", () => {
  it("sizes every child folder in a constant number of queries, with the same numbers", async () => {
    const m = await member();
    const small = await tree(m, "Small", 3, 4);
    const large = await tree(m, "Large", 600, 4);
    await getFolderView(m.id, large.id);
    const a = await measure(() => getFolderView(m.id, small.id));
    const b = await measure(() => getFolderView(m.id, large.id));
    report("getFolderView 3 vs 600 subfolders", a, b);
    expect.soft(b.queries).toBe(a.queries);

    const view = b.result;
    const perFolder = bytesOf(4) + bytesOf(2);
    const sub = view.children.find((item) => item.name === "d7")!;
    expect([sub.size, sub.fileCount, sub.itemCount]).toEqual([String(perFolder), 6, 5]);
    const file = view.children.find((item) => item.name === "top-3.txt")!;
    expect([file.size, file.fileCount, file.itemCount]).toEqual(["3", 1, 0]);
    expect([view.folder.size, view.folder.fileCount, view.folder.itemCount]).toEqual([String(600 * perFolder + bytesOf(3)), 600 * 6 + 3, 603]);
    expect(view.path.map((crumb) => crumb.name)).toEqual(["root", "Large"]);
    expect(view.children).toHaveLength(603);
  }, SLOW);
});

describe("share page", () => {
  /** A public link folder whose private, password and expired items (and what they hold) are left out. */
  async function sharedTree(m: FixtureMember, name: string, folders: number) {
    const top = await tree(m, name, folders, 5, { visibility: "PUBLIC" });
    const d0 = (await prisma.node.findFirstOrThrow({ where: { parentId: top.id, name: "d0" } })).id;
    const hidden = await folderRow(m, d0, "Hidden", { visibility: "PRIVATE" });
    await filesIn(m, hidden.id, null, 4, "h");
    const locked = await folderRow(m, d0, "Locked", { passwordHash: await hash("pw") });
    await filesIn(m, locked.id, null, 4, "l");
    const old = await folderRow(m, d0, "Old", { expAt: new Date(Date.now() - 1_000) });
    await filesIn(m, old.id, null, 4, "o");
    await filesIn(m, d0, null, 1, "private", { visibility: "PRIVATE" });
    await filesIn(m, d0, null, 1, "later", { expAt: new Date(Date.now() + 3_600_000) });
    return { top, d0, hidden };
  }

  it("reads only the folder being viewed, and leaves out what visitors may not see", async () => {
    const m = await member();
    const small = await sharedTree(m, "ShareSmall", 3);
    const large = await sharedTree(m, "ShareLarge", 2_000);
    await sharePage(large.top.linkId, large.d0, noViewer, Date.now());
    const a = await measure(() => sharePage(small.top.linkId, small.d0, noViewer, Date.now()));
    const b = await measure(() => sharePage(large.top.linkId, large.d0, noViewer, Date.now()));
    report("sharePage subfolder (8 items) of a link with 3 vs 2,000 subfolders", a, b);
    expect.soft(b.queries).toBe(a.queries);

    const view = b.result!.page.view!;
    // d0: 5 files, deep/ (2 files) and the file that expires later; nothing private, locked or expired.
    expect(view.items.map((item) => item.name)).toEqual(["deep", "f-1.txt", "f-2.txt", "f-3.txt", "f-4.txt", "f-5.txt", "later-1.txt"]);
    expect(view.items[0]).toMatchObject({ type: "folder", size: String(bytesOf(2)), itemCount: 2 });
    expect([view.size, view.count]).toEqual([String(bytesOf(5) + bytesOf(2) + 1), 7]);
    expect(view.crumbs.map((crumb) => crumb.name)).toEqual(["ShareLarge", "d0"]);
    expect(view.folder.parentId).toBe(large.top.id);

    const root = (await sharePage(large.top.linkId, null, noViewer, Date.now()))!.page.view!;
    const perFolder = bytesOf(5) + bytesOf(2);
    expect([root.size, root.count]).toEqual([String(2_000 * perFolder + 1 + bytesOf(3)), 2_003]);
    expect(root.items.find((item) => item.name === "d0")).toMatchObject({ size: String(perFolder + 1), itemCount: 7 });
    expect(await sharePage(large.top.linkId, large.hidden.id, noViewer, Date.now())).toBeNull();
  }, SLOW);
});

describe("bulk operations", () => {
  const owner = async (m: FixtureMember) => (await findAccountById(prisma, m.id))!;

  /** `count` files in a new folder, as selected items. */
  async function selection(m: FixtureMember, name: string, count: number) {
    const folder = await folderRow(m, m.rootId, name);
    const ids = await filesIn(m, folder.id, [name], count);
    return { folder, ids };
  }

  it("finds the top-level items of a selection in a constant number of queries", async () => {
    const m = await member();
    const small = await selection(m, "TopSmall", 10);
    const large = await selection(m, "TopLarge", 1_000);
    const a = await measure(() => topLevel(m.id, [small.folder.id, ...small.ids]));
    const b = await measure(() => topLevel(m.id, [...large.ids, ...small.ids.slice(0, 2)]));
    report("topLevel 11 vs 1,002 ids", a, b);
    expect(b.queries).toBe(a.queries);
    expect(a.result.map(({ row }) => row.id)).toEqual([small.folder.id]);
    expect(a.result[0]!.chain.map((ancestor) => ancestor.name)).toEqual(["root", "TopSmall"]);
    expect(b.result).toHaveLength(1_002);
    expect(b.result.every(({ row, chain }) => chain.at(-1)!.id === row.id && chain.length === 3)).toBe(true);
  }, SLOW);

  it("zips, copies, moves and deletes 1,000 items in a constant number of queries", async () => {
    const m = await member();
    const account = await owner(m);
    const small = await selection(m, "OpsSmall", 10);
    const large = await selection(m, "OpsLarge", 1_000);
    const target = await folderRow(m, m.rootId, "Target");
    await mkdir(join(m.dir, "Target"), { recursive: true });
    const copyTarget = await folderRow(m, m.rootId, "Copies");
    await mkdir(join(m.dir, "Copies"), { recursive: true });

    const zip = async (ids: string[]) => Buffer.from(await (await zipItems(account, ids)).arrayBuffer());
    const zipA = await measure(() => zip(small.ids));
    const zipB = await measure(() => zip(large.ids));
    report("zipItems 10 vs 1,000", zipA, zipB);
    for (const name of ["f-1.txt", "f-1000.txt"]) expect(zipB.result.includes(Buffer.from(name)), name).toBe(true);

    const copyA = await measure(() => copyNodes(account, small.ids, copyTarget.id));
    const copyB = await measure(() => copyNodes(account, large.ids, copyTarget.id));
    report("copyNodes 10 vs 1,000", copyA, copyB);
    expect(copyB.result).toMatchObject({ done: 1_000, renamed: 10 });
    expect(await prisma.node.count({ where: { parentId: copyTarget.id } })).toBe(1_010);

    const moveA = await measure(() => moveNodes(account, small.ids, target.id));
    const moveB = await measure(() => moveNodes(account, large.ids, target.id));
    report("moveNodes 10 vs 1,000", moveA, moveB);
    expect(moveB.result).toMatchObject({ done: 1_000, renamed: 10 });
    expect(await readFile(join(m.dir, "Target", "f-1000.txt"), "utf8")).toBe("x".repeat(1_000));

    const deleteA = await measure(() => deleteItems(account, small.ids));
    const deleteB = await measure(() => deleteItems(account, large.ids));
    report("deleteItems 10 vs 1,000", deleteA, deleteB);
    expect(deleteB.result.deleted).toBe(1_000);
    expect(await prisma.node.count({ where: { parentId: target.id } })).toBe(0);
    expect(await prisma.deletedItem.count({ where: { accountId: m.id } })).toBe(1_010);

    for (const [a, b] of [
      [zipA, zipB],
      [copyA, copyB],
      [moveA, moveB],
      [deleteA, deleteB],
    ] as const)
      expect(b.queries).toBe(a.queries);
  }, SLOW);

  it("keeps folder structure, settings and locations for nested selections", async () => {
    const m = await member();
    const account = await owner(m);
    // Trip/{a.txt, Day1/b.txt, Locked (password)/c.txt, Hidden (private)/d.txt} and Other/e.txt.
    const trip = await folderRow(m, m.rootId, "Trip");
    const [a] = await filesIn(m, trip.id, ["Trip"], 1, "a");
    const day = await folderRow(m, trip.id, "Day1");
    const [b] = await filesIn(m, day.id, ["Trip", "Day1"], 1, "b");
    const locked = await folderRow(m, trip.id, "Locked", { passwordHash: await hash("pw") });
    await filesIn(m, locked.id, ["Trip", "Locked"], 1, "c");
    const hidden = await folderRow(m, trip.id, "Hidden", { visibility: "PRIVATE" });
    await filesIn(m, hidden.id, ["Trip", "Hidden"], 1, "d");
    const other = await folderRow(m, m.rootId, "Other");
    const [e] = await filesIn(m, other.id, ["Other"], 1, "e");
    // Items inside a selected folder are left to it.
    const selected = [trip.id, a!, b!, e!];
    expect((await topLevel(m.id, selected)).map(({ row }) => row.name).sort()).toEqual(["Trip", "e-1.txt"]);

    const zipped = Buffer.from(await (await zipItems(account, selected)).arrayBuffer());
    for (const name of ["Trip/a-1.txt", "Trip/Day1/b-1.txt", "Trip/Locked/c-1.txt", "Trip/Hidden/d-1.txt", "e-1.txt"]) expect(zipped.includes(Buffer.from(name)), name).toBe(true);

    const copies = await folderRow(m, m.rootId, "Copies");
    await mkdir(join(m.dir, "Copies"), { recursive: true });
    expect(await copyNodes(account, selected, copies.id)).toMatchObject({ done: 2, renamed: 0 });
    const copiedTrip = await prisma.node.findFirstOrThrow({ where: { parentId: copies.id, name: "Trip" } });
    const copiedLocked = await prisma.node.findFirstOrThrow({ where: { parentId: copiedTrip.id, name: "Locked" } });
    expect(copiedLocked.passwordHash).not.toBeNull();
    expect((await prisma.node.findFirstOrThrow({ where: { parentId: copiedTrip.id, name: "Hidden" } })).visibility).toBe("PRIVATE");
    expect(await readFile(join(m.dir, "Copies", "Trip", "Day1", "b-1.txt"), "utf8")).toBe("x");

    const moved = await folderRow(m, m.rootId, "Moved");
    await mkdir(join(m.dir, "Moved"), { recursive: true });
    expect(await moveNodes(account, selected, moved.id)).toMatchObject({ done: 2, renamed: 0 });
    expect(await readFile(join(m.dir, "Moved", "Trip", "Locked", "c-1.txt"), "utf8")).toBe("x");
    expect(await readFile(join(m.dir, "Moved", "e-1.txt"), "utf8")).toBe("x");

    expect(await deleteItems(account, selected)).toEqual({ deleted: 2 });
    const deleted = await prisma.deletedItem.findMany({ where: { accountId: m.id }, orderBy: { name: "asc" } });
    expect(deleted.map((item) => [item.name, item.itemCount, item.size, item.originalPath])).toEqual([
      ["Trip", 8, 4n, ["root", "Moved"]],
      ["e-1.txt", 1, 1n, ["root", "Moved"]],
    ]);
    expect(await prisma.trashedBytes.count({ where: { accountId: m.id } })).toBe(2);
  }, SLOW);
});

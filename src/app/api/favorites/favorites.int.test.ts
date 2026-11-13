import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { GET as getFolder } from "@/app/api/folders/[id]/route";
import { POST as createFolder } from "@/app/api/folders/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { POST as transfer } from "@/app/api/nodes/transfer/route";
import { GET as trashList } from "@/app/api/trash/route";
import { POST as restore } from "@/app/api/trash/[id]/restore/route";
import { DELETE as deleteGroup, GET as groupCount, PATCH as renameGroup } from "@/app/api/favorites/folders/[id]/route";
import { POST as createGroup } from "@/app/api/favorites/folders/route";
import { POST as move } from "@/app/api/favorites/move/route";
import { POST as unfavorite } from "@/app/api/favorites/remove/route";
import { GET as view, POST as favorite } from "@/app/api/favorites/route";
import { GET as tagged } from "@/app/api/favorites/tags/route";
import type { CreatedAccount } from "@/contracts/auth";
import type { FavoriteFolderDto, FavoritesView } from "@/contracts/favorites";
import type { CreatedFolder, FolderView, TaggedItem } from "@/contracts/nodes";
import type { DeletedItemDto } from "@/contracts/trash";
import { FILES } from "@/config/policy";
import { newLinkId, newNodeId } from "@/domain/ids";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { favoriteFolderPage } from "@/server/services/favorites.service";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { randomTestIp } from "../../../../test/file-fixtures";
import { callRoute } from "../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];

interface Session {
  id: string;
  cookie: string;
}

async function member(): Promise<Session> {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  const id = res.json.data.account.id;
  accounts.push(id);
  return { id, cookie: res.cookie! };
}

const folder = async (s: Session, parentId: string, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: s.cookie, body: { parentId, name } })).json.data.folder;
const list = async (s: Session, id = "root") => (await callRoute<FolderView, { id: string }>(getFolder, { cookie: s.cookie, params: { id } })).json.data;
const add = (s: Session, nodeIds: string[], folderId: string | null = null) => callRoute<{ added: number }>(favorite, { method: "POST", cookie: s.cookie, body: { nodeIds, folderId } });
const look = (s: Session, folder?: string) => callRoute<FavoritesView>(view, { cookie: s.cookie, query: folder ? `?folder=${folder}` : "" });
const group = (s: Session, parentId: string | null, name: string) => callRoute<FavoriteFolderDto>(createGroup, { method: "POST", cookie: s.cookie, body: { parentId, name } });

/** A file row; with `segments` (its folder path below the root) also its bytes on disk, for copies and deletes. */
async function file(s: Session, parentId: string, name: string, segments?: string[]) {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: s.id, parentId, type: "FILE", kind: "OTHER", name, size: 1n, linkId: newLinkId() } });
  if (segments) await writeFile(join(userRootOf(configuredVolumeRoot(), s.id), ...segments, name), "x");
  return id;
}

const rootOf = async (s: Session) => (await list(s)).folder.id;

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("favorites", () => {
  it("lists items where they are, marks them in folder views and takes them out again", async () => {
    const s = await member();
    const docs = await folder(s, "root", "Docs");
    const a = await file(s, docs.id, "a.txt");
    const b = await file(s, await rootOf(s), "b.txt");

    expect((await add(s, [a, docs.id])).json.data).toEqual({ added: 2 });
    await add(s, [b]);
    // Adding again changes nothing.
    expect((await add(s, [a])).json.data).toEqual({ added: 0 });

    const top = (await look(s)).json.data;
    // Newest favorite first (a and Docs were added together).
    expect(top.items[0]?.name).toBe("b.txt");
    expect(top.items.map((item) => item.name).sort()).toEqual(["Docs", "a.txt", "b.txt"]);
    const listedA = top.items.find((item) => item.id === a)!;
    expect({ parentPath: listedA.parentPath, parentId: listedA.parentId, favorite: listedA.favorite }).toEqual({ parentPath: "root / Docs", parentId: docs.id, favorite: true });

    const root = await list(s);
    expect(root.favoriteCount).toBe(3);
    expect(root.children.find((item) => item.id === docs.id)?.favorite).toBe(true);
    expect((await list(s, docs.id)).favoriteCount).toBeUndefined();

    expect((await callRoute(unfavorite, { method: "POST", cookie: s.cookie, body: { nodeIds: [a] } })).json.data).toEqual({ removed: 1 });
    expect(await prisma.node.count({ where: { id: a } })).toBe(1);
    expect((await list(s)).favoriteCount).toBe(2);
  });

  it("refuses the root, other accounts' items and more than the limit", async () => {
    const s = await member();
    const other = await member();
    const theirs = await file(other, await rootOf(other), "x.txt");
    expect((await add(s, [theirs])).status).toBe(404);
    expect((await add(s, [await rootOf(s)])).status).toBe(400);

    const root = await rootOf(s);
    const ids = Array.from({ length: FILES.maxFavorites }, () => newNodeId());
    await prisma.node.createMany({ data: ids.map((id, index) => ({ id, accountId: s.id, parentId: root, type: "FILE" as const, kind: "OTHER" as const, name: `f${index}`, linkId: newLinkId() })) });
    expect((await add(s, ids.slice(0, FILES.maxFavorites - 1))).status).toBe(201);
    // Two requests race for the last place: exactly one gets it.
    const results = await Promise.all([add(s, [ids.at(-1)!]), add(s, [await file(s, root, "extra")])]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 400]);
    expect(await prisma.favorite.count({ where: { accountId: s.id } })).toBe(FILES.maxFavorites);
  });

  it("organizes favorites in folders: names, moves, cycles and depth", async () => {
    const s = await member();
    const a = await file(s, await rootOf(s), "a.txt");
    const work = (await group(s, null, "Work")).json.data;
    expect((await group(s, null, "Work")).status).toBe(409);
    expect((await group(s, null, " ")).status).toBe(400);
    const sub = (await group(s, work.id, "2026")).json.data;
    expect((await add(s, [a], sub.id)).status).toBe(201);

    const inWork = (await look(s, work.id)).json.data;
    expect({ path: inWork.path.map((crumb) => crumb.name), folders: inWork.folders.map((f) => [f.name, f.itemCount]) }).toEqual({ path: ["Work"], folders: [["2026", 1]] });
    expect((await look(s, sub.id)).json.data.items.map((item) => item.id)).toEqual([a]);
    expect((await look(s, newNodeId())).status).toBe(404);

    // A folder cannot go into itself or below itself.
    expect((await callRoute(move, { method: "POST", cookie: s.cookie, body: { folderIds: [work.id], to: sub.id } })).status).toBe(400);
    expect((await callRoute(renameGroup, { method: "PATCH", cookie: s.cookie, params: { id: sub.id }, body: { name: "Archive" } })).status).toBe(200);
    expect((await callRoute(move, { method: "POST", cookie: s.cookie, body: { nodeIds: [a], folderIds: [sub.id], to: null } })).json.data).toEqual({ moved: 2 });
    const top = (await look(s)).json.data;
    expect({ folders: top.folders.map((f) => f.name).sort(), items: top.items.map((item) => item.id) }).toEqual({ folders: ["Archive", "Work"], items: [a] });

    // Depth: a chain of FILES.favoriteFolderMaxDepth levels takes no more.
    let parent: string | null = null;
    for (let level = 1; level <= FILES.favoriteFolderMaxDepth; level++) parent = (await group(s, parent, `L${level}`)).json.data.id;
    expect((await group(s, parent, "too deep")).status).toBe(400);
  });

  it("deletes an organizing folder with its favorites, or moves them up", async () => {
    const s = await member();
    const root = await rootOf(s);
    const [a, b, c] = [await file(s, root, "a"), await file(s, root, "b"), await file(s, root, "c")];
    const outer = (await group(s, null, "Outer")).json.data;
    const inner = (await group(s, outer.id, "Inner")).json.data;
    await group(s, null, "Inner");
    await add(s, [a], outer.id);
    await add(s, [b], inner.id);
    await add(s, [c]);

    expect((await callRoute<{ favorites: number }, { id: string }>(groupCount, { cookie: s.cookie, params: { id: outer.id } })).json.data).toEqual({ favorites: 2 });
    // Lift: a and the Inner folder move to the top; "Inner" is taken there, so it becomes "Inner (2)".
    expect((await callRoute(deleteGroup, { method: "DELETE", cookie: s.cookie, params: { id: outer.id }, query: "?mode=lift" })).json.data).toEqual({ removedFavorites: 0, movedUp: 2 });
    const top = (await look(s)).json.data;
    expect({ folders: top.folders.map((f) => f.name).sort(), items: top.items.map((item) => item.id).sort() }).toEqual({ folders: ["Inner", "Inner (2)"], items: [a, c].sort() });

    expect((await callRoute(deleteGroup, { method: "DELETE", cookie: s.cookie, params: { id: inner.id }, query: "?mode=remove" })).json.data).toEqual({ removedFavorites: 1, movedUp: 0 });
    expect(await prisma.favorite.count({ where: { accountId: s.id } })).toBe(2);
    // The items themselves are all still there.
    expect(await prisma.node.count({ where: { id: { in: [a, b, c] } } })).toBe(3);
  });

  it("keeps favorites through delete and restore, and not on copies", async () => {
    const s = await member();
    const docs = await folder(s, "root", "Docs");
    const inside = await file(s, docs.id, "inside.txt", ["Docs"]);
    const keep = (await group(s, null, "Keep")).json.data;
    await add(s, [docs.id], keep.id);
    await add(s, [inside]);

    const copied = await callRoute<{ items: { id: string }[] }>(transfer, { method: "POST", cookie: s.cookie, body: { ids: [docs.id], targetId: "root", mode: "copy" } });
    expect(copied.status).toBe(200);
    expect(await prisma.favorite.count({ where: { accountId: s.id } })).toBe(2);

    expect((await callRoute(remove, { method: "POST", cookie: s.cookie, body: { ids: [docs.id] } })).status).toBe(200);
    expect(await prisma.favorite.count({ where: { accountId: s.id } })).toBe(0);
    // The organizing folder is gone by restore time: the folder comes back at the top.
    await callRoute(deleteGroup, { method: "DELETE", cookie: s.cookie, params: { id: keep.id }, query: "?mode=remove" });
    const [item] = (await callRoute<DeletedItemDto[]>(trashList, { cookie: s.cookie })).json.data;
    expect((await callRoute(restore, { method: "POST", cookie: s.cookie, params: { id: item!.id } })).status).toBe(200);
    const rows = await prisma.favorite.findMany({ where: { accountId: s.id }, select: { nodeId: true, folderId: true } });
    expect(rows.sort((x, y) => x.nodeId.localeCompare(y.nodeId))).toEqual([{ nodeId: docs.id, folderId: null }, { nodeId: inside, folderId: null }].sort((x, y) => x.nodeId.localeCompare(y.nodeId)));
  });

  it("opens favorite folders only along the chain below them", async () => {
    const s = await member();
    const docs = await folder(s, "root", "Docs");
    const sub = await folder(s, docs.id, "Sub");
    const elsewhere = await folder(s, "root", "Elsewhere");
    const keep = (await group(s, null, "Keep")).json.data;
    await expect(favoriteFolderPage(s, [docs.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await add(s, [docs.id], keep.id);
    const page = await favoriteFolderPage(s, [docs.id, sub.id]);
    expect({ groups: page.groups.map((g) => g.name), chain: page.chain.map((c) => c.name), shown: page.view.folder.id }).toEqual({ groups: ["Keep"], chain: ["Docs", "Sub"], shown: sub.id });
    await expect(favoriteFolderPage(s, [docs.id, elsewhere.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await member();
    await expect(favoriteFolderPage(other, [docs.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("searches tags across every organizing folder, only among this account's favorites", async () => {
    const s = await member();
    const docs = await folder(s, "root", "Docs");
    const keep = (await group(s, null, "Keep")).json.data;
    const both = await file(s, docs.id, "both.txt");
    const one = await file(s, await rootOf(s), "one.txt");
    const plain = await file(s, docs.id, "plain.txt");
    await prisma.node.updateMany({ where: { id: { in: [both, plain] } }, data: { tags: ["a", "b"] } });
    await prisma.node.update({ where: { id: one }, data: { tags: ["a"] } });
    await add(s, [both], keep.id);
    await add(s, [one]);
    const search = (who: Session, tags: string) => callRoute<TaggedItem[]>(tagged, { cookie: who.cookie, query: `?tags=${tags}` });

    const names = async (who: Session, tags: string) => (await search(who, tags)).json.data.map((item) => item.name).sort();
    expect(await names(s, "a")).toEqual(["both.txt", "one.txt"]);
    expect(await names(s, "a,b")).toEqual(["both.txt"]);
    const [hit] = (await search(s, "b")).json.data;
    expect({ path: hit!.parentPath, favorite: hit!.favorite }).toEqual({ path: "root / Docs", favorite: true });
    expect((await search(s, "")).status).toBe(400);
    expect(await names(await member(), "a")).toEqual([]);
  });
});

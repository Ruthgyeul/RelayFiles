import { NextRequest } from "next/server";
import { hash } from "@node-rs/argon2";
import { afterAll, describe, expect, it } from "vitest";
import { DELETE as removeCollection, PATCH as patchCollection } from "@/app/api/collections/[id]/route";
import { GET as listCollections, POST as createCollection } from "@/app/api/collections/route";
import { POST as removeNodes } from "@/app/api/nodes/delete/route";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { POST as unlock } from "@/app/api/share/[linkId]/unlock/route";
import { GET as shareZip, HEAD as shareZipCheck } from "@/app/api/share/[linkId]/zip/route";
import { POST as restore } from "@/app/api/trash/[id]/restore/route";
import type { CollectionDto } from "@/contracts/collections";
import { newLinkId, newNodeId } from "@/domain/ids";
import { closeQueues } from "@/server/jobs/queue";
import { sharePage } from "@/server/share/share-view";
import { UNLOCK_COOKIE, type Unlocks } from "@/server/share/unlock-cookie";
import { VISITOR_COOKIE } from "@/server/share/visitor-cookie";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();
const noViewer = { accountIds: [], unlocks: new Map() as Unlocks, visitorId: null };

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

async function folder(m: FixtureMember, parentId: string, name: string, data: Record<string, unknown> = {}) {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, linkId: newLinkId(), ...data } });
  return id;
}

/**
 * Private items, none of them public on their own: notes.txt, Trip/ (b.txt, Hidden/ private
 * with secret.txt), Locked/ (password) with c.txt, and other.txt left out of the collection.
 */
async function account() {
  const m = await member();
  const notes = await addFile(m, m.rootId, [], "notes.txt", "alpha", "text/plain");
  const trip = await folder(m, m.rootId, "Trip");
  const b = await addFile(m, trip, ["Trip"], "b.txt", "bravo", "text/plain");
  const hidden = await folder(m, trip, "Hidden", { visibility: "PRIVATE" });
  const secret = await addFile(m, hidden, ["Trip", "Hidden"], "secret.txt", "classified", "text/plain");
  const locked = await folder(m, m.rootId, "Locked", { passwordHash: await hash("folder pass") });
  const c = await addFile(m, locked, ["Locked"], "c.txt", "charlie", "text/plain");
  const other = await addFile(m, m.rootId, [], "other.txt", "delta", "text/plain");
  return { m, notes, trip, b, hidden, secret, locked, c, other };
}

const create = (m: FixtureMember, body: Record<string, unknown>) => callRoute<CollectionDto>(createCollection, { method: "POST", cookie: m.cookie, body });
const patch = (m: FixtureMember, id: string, body: Record<string, unknown>) => callRoute<CollectionDto, { id: string }>(patchCollection, { method: "PATCH", cookie: m.cookie, body, params: { id } });

/** A visitor's request (no account), with optional cookies. */
function visit<P>(handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>, path: string, params: P, options: { method?: string; body?: unknown; cookies?: string[]; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "x-real-ip": randomTestIp(), ...options.headers });
  if (options.cookies?.length) headers.set("cookie", options.cookies.join("; "));
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return handler(new NextRequest(`http://localhost${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }), { params: Promise.resolve(params) });
}

const download = (linkId: string, id: string, cookies: string[] = [], headers: Record<string, string> = {}) => visit(shareDownload, `/api/share/${linkId}/files/${id}/download`, { linkId, id }, { cookies, headers });
/** The `rf_dv=<id>` pair a response set (the browser a counted download start belongs to). */
const visitorCookie = (res: Response) => res.headers.getSetCookie().find((line) => line.startsWith(`${VISITOR_COOKIE}=`))!.split(";")[0]!;
const zip = (linkId: string, folderId: string) => visit(shareZip, `/api/share/${linkId}/zip?folder=${folderId}`, { linkId });

describe("collection links", () => {
  it("creates a collection of the account's own items only", async () => {
    const { m, notes, trip } = await account();
    const stranger = await account();
    expect((await create(m, { name: "Mixed", nodeIds: [notes, stranger.notes] })).status).toBe(404);
    expect((await create(m, { name: " ", nodeIds: [notes] })).status).toBe(400);

    const created = await create(m, { name: "Weekend", note: "For you", nodeIds: [trip, notes] });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ name: "Weekend", note: "For you", downloads: 0, hasPassword: false, access: "both" });
    expect(created.json.data.items.map((item) => item.name)).toEqual(["Trip", "notes.txt"]);
    expect(created.json.data.url).toMatch(new RegExp(`/d/${created.json.data.linkId}$`));
    // Its link is not any item's.
    expect(await prisma.node.count({ where: { linkId: created.json.data.linkId } })).toBe(0);

    const listed = await callRoute<CollectionDto[]>(listCollections, { cookie: m.cookie });
    expect(listed.json.data.map((collection) => collection.id)).toEqual([created.json.data.id]);
    // Another account sees none of it and cannot change or delete it.
    expect((await callRoute<CollectionDto[]>(listCollections, { cookie: stranger.m.cookie })).json.data).toEqual([]);
    expect((await patch(stranger.m, created.json.data.id, { name: "Mine" })).status).toBe(404);
    expect((await callRoute(removeCollection, { method: "DELETE", cookie: stranger.m.cookie, params: { id: created.json.data.id } })).status).toBe(404);
  });

  it("shows its items to visitors, private as they are, but nothing behind a password or outside it", async () => {
    const { m, notes, trip, b, secret, locked, c, other } = await account();
    const { data } = (await create(m, { name: "Weekend", note: "For you", nodeIds: [notes, trip, locked] })).json;

    const top = (await sharePage(data.linkId, null, noViewer, Date.now()))!.page;
    expect(top).toMatchObject({ status: "open", name: "Weekend", owner: null });
    expect(top.view!.root).toMatchObject({ id: data.id, type: "folder" });
    expect(top.view!.items.map((item) => item.name)).toEqual(["Trip", "notes.txt"]);
    expect(top.view!.items[0]).toMatchObject({ type: "folder", itemCount: 1, size: "5" });
    expect(top.view!.note).toBe("For you");
    expect(top.view!.crumbs).toEqual([{ id: data.id, name: "Weekend" }]);

    const inside = (await sharePage(data.linkId, trip, noViewer, Date.now()))!.page.view!;
    expect(inside.items.map((item) => item.name)).toEqual(["b.txt"]);
    expect(inside.folder.parentId).toBe(data.id);
    expect(inside.crumbs.map((crumb) => crumb.name)).toEqual(["Weekend", "Trip"]);

    expect((await download(data.linkId, b)).status).toBe(200);
    expect(await (await download(data.linkId, notes)).text()).toBe("alpha");
    for (const id of [secret, c, other]) expect((await download(data.linkId, id)).status, id).toBe(404);
    expect(await sharePage(data.linkId, locked, noViewer, Date.now())).toBeNull();
    // Counted on the collection, not on the items' own links.
    expect((await prisma.shareCollection.findUniqueOrThrow({ where: { id: data.id } })).downloads).toBe(2);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: notes } })).downloads).toBe(1);
  });

  it("applies its own download limit, password and stream only", async () => {
    const { m, notes, trip } = await account();
    const limited = (await create(m, { name: "Once", downloadLimit: 1, nodeIds: [notes] })).json.data;
    expect((await download(limited.linkId, notes)).status).toBe(200);
    expect((await download(limited.linkId, notes)).status).toBe(403);
    expect((await sharePage(limited.linkId, null, noViewer, Date.now()))!.page.status).toBe("blocked");

    const locked = (await create(m, { name: "Locked", password: "open sesame", nodeIds: [notes] })).json.data;
    expect((await sharePage(locked.linkId, null, noViewer, Date.now()))!.page).toMatchObject({ status: "locked", name: "Locked", view: null });
    expect((await download(locked.linkId, notes)).status).toBe(401);
    expect((await visit(unlock, `/api/share/${locked.linkId}/unlock`, { linkId: locked.linkId }, { method: "POST", body: { password: "nope" } })).status).toBe(403);
    const right = await visit(unlock, `/api/share/${locked.linkId}/unlock`, { linkId: locked.linkId }, { method: "POST", body: { password: "open sesame" } });
    expect(right.status).toBe(200);
    const cookie = right.headers.getSetCookie().find((line) => line.startsWith(`${UNLOCK_COOKIE}=`))!.split(";")[0]!;
    expect((await download(locked.linkId, notes, [cookie])).status).toBe(200);

    const streamOnly = (await create(m, { name: "Watch", access: "stream", nodeIds: [notes, trip] })).json.data;
    expect((await download(streamOnly.linkId, notes)).status).toBe(403);
    expect((await zip(streamOnly.linkId, streamOnly.id)).status).toBe(403);
    expect((await sharePage(streamOnly.linkId, null, noViewer, Date.now()))!.page.view).toMatchObject({ downloadsAllowed: false });
    expect((await sharePage(streamOnly.linkId, null, noViewer, Date.now()))!.page.view!.items.every((item) => !item.canDownload)).toBe(true);

    // Settings change and the link stops working once deleted.
    expect((await patch(m, streamOnly.id, { access: "both", name: "Watch again" })).json.data).toMatchObject({ access: "both", name: "Watch again" });
    expect((await download(streamOnly.linkId, notes)).status).toBe(200);
    expect((await callRoute(removeCollection, { method: "DELETE", cookie: m.cookie, params: { id: streamOnly.id } })).status).toBe(200);
    expect((await download(streamOnly.linkId, notes)).status).toBe(404);
    expect(await prisma.node.count({ where: { id: notes } })).toBe(1);
  });

  it("lets the browser that took the last download resume it, and nobody else", async () => {
    const { m, notes } = await account();
    const limited = (await create(m, { name: "Once", downloadLimit: 1, nodeIds: [notes] })).json.data;
    const first = await download(limited.linkId, notes);
    expect(first.status).toBe(200);
    const browser = visitorCookie(first);
    expect((await sharePage(limited.linkId, null, noViewer, Date.now()))!.page.status).toBe("blocked");
    // The interrupted transfer continues from byte 2; a new start or another browser is refused.
    const resumed = await download(limited.linkId, notes, [browser], { range: "bytes=2-" });
    expect(resumed.status).toBe(206);
    expect(await resumed.text()).toBe("pha");
    expect((await download(limited.linkId, notes, [browser])).status).toBe(403);
    expect((await download(limited.linkId, notes, [], { range: "bytes=2-" })).status).toBe(403);
    expect((await prisma.shareCollection.findUniqueOrThrow({ where: { id: limited.id } })).downloads).toBe(1);

    // The same for a file's own limit, through its own link.
    await prisma.node.update({ where: { id: notes }, data: { visibility: "PUBLIC", downloadLimit: 2 } });
    const { linkId } = await prisma.node.findUniqueOrThrow({ where: { id: notes } });
    const own = await download(linkId, notes);
    expect(own.status).toBe(200);
    expect((await download(linkId, notes, [visitorCookie(own)], { range: "bytes=1-" })).status).toBe(206);
    expect((await download(linkId, notes)).status).toBe(403);
  });

  it("shows items under a folder with no downloads left as not downloadable", async () => {
    const { m, trip, b } = await account();
    await prisma.node.update({ where: { id: trip }, data: { downloadLimit: 1, downloads: 1 } });
    const { data } = (await create(m, { name: "Spent", nodeIds: [b] })).json;
    const view = (await sharePage(data.linkId, null, noViewer, Date.now()))!.page.view!;
    expect(view.items).toMatchObject([{ name: "b.txt", canDownload: false }]);
    expect((await download(data.linkId, b)).status).toBe(403);
  });

  it("zips the whole collection under its name, leaving out what visitors cannot see", async () => {
    const { m, notes, trip, locked } = await account();
    const { data } = (await create(m, { name: "Weekend", nodeIds: [notes, trip, locked] })).json;
    expect((await visit(shareZipCheck, `/api/share/${data.linkId}/zip?folder=${data.id}`, { linkId: data.linkId }, { method: "HEAD" })).status).toBe(200);
    const res = await zip(data.linkId, data.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Weekend.zip"');
    const bytes = Buffer.from(await res.arrayBuffer());
    for (const name of ["Weekend/notes.txt", "Weekend/Trip/b.txt", "alpha", "bravo"]) expect(bytes.includes(Buffer.from(name)), name).toBe(true);
    for (const name of ["secret.txt", "classified", "c.txt", "charlie"]) expect(bytes.includes(Buffer.from(name)), name).toBe(false);
    // A folder inside it zips on its own too.
    const folderZip = Buffer.from(await (await zip(data.linkId, trip)).arrayBuffer());
    expect(folderZip.includes(Buffer.from("Trip/b.txt"))).toBe(true);
    expect((await prisma.shareCollection.findUniqueOrThrow({ where: { id: data.id } })).downloads).toBe(2);
  });

  it("drops deleted items and puts them back when they are restored", async () => {
    const { m, notes, trip } = await account();
    const { data } = (await create(m, { name: "Weekend", nodeIds: [notes, trip] })).json;
    const deleted = await callRoute<{ trashIds: string[] }>(removeNodes, { method: "POST", cookie: m.cookie, body: { ids: [notes] } });
    expect((await sharePage(data.linkId, null, noViewer, Date.now()))!.page.view!.items.map((item) => item.name)).toEqual(["Trip"]);
    expect((await download(data.linkId, notes)).status).toBe(404);

    expect((await callRoute(restore, { method: "POST", cookie: m.cookie, params: { id: deleted.json.data.trashIds[0]! } })).status).toBe(200);
    expect((await sharePage(data.linkId, null, noViewer, Date.now()))!.page.view!.items.map((item) => item.name)).toEqual(["Trip", "notes.txt"]);
    expect((await download(data.linkId, notes)).status).toBe(200);
  });
});

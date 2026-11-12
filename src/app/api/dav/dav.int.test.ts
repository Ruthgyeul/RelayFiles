import { afterAll, describe, expect, it } from "vitest";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import { newLinkId, newNodeId } from "@/domain/ids";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { davHandler } from "@/server/dav/handler";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

async function tokenFor(m: FixtureMember, scopes: string[] = ["files:read"]) {
  const res = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "drive", scopes, expiresInDays: null } });
  expect(res.status).toBe(201);
  return res.json.data.token;
}

const basic = (token: string) => `Basic ${Buffer.from(`relayfiles:${token}`).toString("base64")}`;

function dav(method: string, path: string, token: string | null, headers: Record<string, string> = {}, body?: string) {
  return davHandler(new Request(`http://localhost${path}`, { method, headers: { ...(token ? { authorization: basic(token) } : {}), ...headers }, body }));
}

/** A PUT with Content-Length, as clients send it. */
const put = (path: string, token: string, body: string) => dav("PUT", path, token, { "content-length": String(Buffer.byteLength(body)) }, body);

const child = (parentId: string, name: string) => prisma.node.findFirst({ where: { parentId, name } });

/** Docs/ (folder) with "a b.txt" inside, and notes.txt at the top. */
async function tree(m: FixtureMember) {
  const docs = newNodeId();
  await prisma.node.create({ data: { id: docs, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Docs", linkId: newLinkId() } });
  await addFile(m, docs, ["Docs"], "a b.txt", "inside", "text/plain");
  await addFile(m, m.rootId, [], "notes.txt", "hello dav", "text/plain");
}

describe("webdav reads", () => {
  it("answers OPTIONS without a token and asks for one otherwise", async () => {
    const options = await dav("OPTIONS", "/dav/", null);
    expect(options.status).toBe(200);
    expect(options.headers.get("dav")).toBe("1, 2");
    expect(options.headers.get("allow")).toContain("MOVE");
    const refused = await dav("PROPFIND", "/dav/", null, { depth: "1" });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("Basic");
    expect((await dav("PROPFIND", "/dav/", "rfp_wrong", { depth: "1" })).status).toBe(401);
  });

  it("lists a folder with Depth 1 and only the item with Depth 0, never infinity", async () => {
    const m = await member();
    await tree(m);
    const token = await tokenFor(m);
    const root = await dav("PROPFIND", "/dav/", token, { depth: "1" });
    expect(root.status).toBe(207);
    const xml = await root.text();
    expect(xml).toContain("<D:href>/dav/</D:href>");
    expect(xml).toContain("<D:href>/dav/Docs/</D:href>");
    expect(xml).toContain("<D:href>/dav/notes.txt</D:href>");
    expect(xml).toContain("<D:getcontentlength>9</D:getcontentlength>");

    const docs = await (await dav("PROPFIND", "/dav/Docs/", token, { depth: "1" })).text();
    expect(docs).toContain("<D:href>/dav/Docs/a%20b.txt</D:href>");
    const one = await (await dav("PROPFIND", "/dav/Docs/a%20b.txt", token, { depth: "0" })).text();
    expect(one.match(/<D:response>/g)).toHaveLength(1);
    expect((await dav("PROPFIND", "/dav/", token)).status).toBe(403);
  });

  it("downloads files with Range, and refuses folders and missing paths", async () => {
    const m = await member();
    await tree(m);
    const token = await tokenFor(m);
    const file = await dav("GET", "/dav/notes.txt", token);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("hello dav");
    const part = await dav("GET", "/dav/notes.txt", token, { range: "bytes=6-8" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("dav");
    expect((await dav("GET", "/dav/Docs/", token)).status).toBe(405);
    expect((await dav("PATCH", "/dav/notes.txt", token)).status).toBe(405);
    expect((await dav("PROPFIND", "/dav/missing.txt", token, { depth: "0" })).status).toBe(404);
    expect((await dav("GET", "/dav/../etc/passwd", token)).status).toBe(404);
  });

  it("starts at the token's own account and needs files:read", async () => {
    const m = await member();
    const other = await member();
    await tree(other);
    const token = await tokenFor(m);
    expect((await dav("GET", "/dav/notes.txt", token)).status).toBe(404);
    const writeOnly = await tokenFor(m, ["files:write"]);
    expect((await dav("PROPFIND", "/dav/", writeOnly, { depth: "0" })).status).toBe(403);
  });
});

describe("webdav writes", () => {
  it("needs files:write", async () => {
    const m = await member();
    const readOnly = await tokenFor(m);
    expect((await put("/dav/new.txt", readOnly, "x")).status).toBe(403);
    expect((await dav("MKCOL", "/dav/New", readOnly)).status).toBe(403);
    expect(await child(m.rootId, "new.txt")).toBeNull();
  });

  it("puts new files and keeps the replaced content as a version with the same link", async () => {
    const m = await member();
    const token = await tokenFor(m, ["files:read", "files:write"]);
    expect((await put("/dav/report.txt", token, "first")).status).toBe(201);
    const first = await child(m.rootId, "report.txt");
    expect(first?.size).toBe(5n);

    expect((await put("/dav/report.txt", token, "second!")).status).toBe(204);
    expect(await (await dav("GET", "/dav/report.txt", token)).text()).toBe("second!");
    const second = await child(m.rootId, "report.txt");
    expect(second?.linkId).toBe(first?.linkId);
    expect(await prisma.fileVersion.count({ where: { nodeId: second!.id } })).toBe(1);
    expect(await prisma.node.count({ where: { accountId: m.id, type: "FILE" } })).toBe(1);

    expect((await put("/dav/Missing/a.txt", token, "x")).status).toBe(409);
    expect((await dav("PUT", "/dav/no-length.txt", token, {}, "x")).status).toBe(411);
    // macOS resource forks are accepted and dropped.
    expect((await put("/dav/._report.txt", token, "fork")).status).toBe(201);
    expect(await child(m.rootId, "._report.txt")).toBeNull();
  });

  it("makes folders once, inside folders that exist", async () => {
    const m = await member();
    const token = await tokenFor(m, ["files:read", "files:write"]);
    expect((await dav("MKCOL", "/dav/Photos", token)).status).toBe(201);
    expect((await dav("MKCOL", "/dav/Photos/", token)).status).toBe(405);
    expect((await dav("MKCOL", "/dav/Nope/Inner", token)).status).toBe(409);
    expect((await child(m.rootId, "Photos"))?.type).toBe("FOLDER");
  });

  it("moves and renames, refuses a folder into itself and respects Overwrite: F", async () => {
    const m = await member();
    await tree(m);
    const token = await tokenFor(m, ["files:read", "files:write"]);
    const move = (from: string, to: string, headers: Record<string, string> = {}) => dav("MOVE", from, token, { destination: `http://localhost${to}`, ...headers });

    expect((await move("/dav/notes.txt", "/dav/renamed.txt")).status).toBe(201);
    expect(await child(m.rootId, "renamed.txt")).not.toBeNull();
    expect((await move("/dav/renamed.txt", "/dav/Docs/moved%20here.txt")).status).toBe(201);
    const docs = await child(m.rootId, "Docs");
    expect(await child(docs!.id, "moved here.txt")).not.toBeNull();

    expect((await move("/dav/Docs/", "/dav/Docs/Inner/")).status).toBe(409);
    expect((await move("/dav/Docs/", "/dav/Docs/")).status).toBe(403);
    expect((await move("/dav/Docs/a%20b.txt", "/dav/Docs/moved%20here.txt", { overwrite: "F" })).status).toBe(412);
    expect((await move("/dav/missing.txt", "/dav/x.txt")).status).toBe(404);
    expect((await move("/dav/Docs/a%20b.txt", "/dav/Gone/x.txt")).status).toBe(409);
  });

  it("saves the way editors do: a temporary file moved over the original becomes its new content", async () => {
    const m = await member();
    const token = await tokenFor(m, ["files:read", "files:write"]);
    await put("/dav/essay.txt", token, "draft one");
    const original = await child(m.rootId, "essay.txt");
    await put("/dav/.essay.tmp", token, "draft two");
    const temp = await child(m.rootId, ".essay.tmp");

    const res = await dav("MOVE", "/dav/.essay.tmp", token, { destination: "/dav/essay.txt" });
    expect(res.status).toBe(204);
    const saved = await child(m.rootId, "essay.txt");
    expect(saved?.id).toBe(temp?.id);
    expect(saved?.linkId).toBe(original?.linkId);
    expect(await child(m.rootId, ".essay.tmp")).toBeNull();
    expect(await prisma.node.findUnique({ where: { id: original!.id } })).toBeNull();
    expect(await prisma.fileVersion.count({ where: { nodeId: saved!.id } })).toBe(1);
    expect(await (await dav("GET", "/dav/essay.txt", token)).text()).toBe("draft two");
  });

  it("copies folders with what is inside and deletes to Recently deleted", async () => {
    const m = await member();
    await tree(m);
    const token = await tokenFor(m, ["files:read", "files:write"]);
    expect((await dav("COPY", "/dav/Docs/", token, { destination: "/dav/Docs%20copy/" })).status).toBe(201);
    expect(await (await dav("GET", "/dav/Docs%20copy/a%20b.txt", token)).text()).toBe("inside");
    expect(await (await dav("GET", "/dav/Docs/a%20b.txt", token)).text()).toBe("inside");

    expect((await dav("DELETE", "/dav/Docs%20copy/", token)).status).toBe(204);
    expect(await child(m.rootId, "Docs copy")).toBeNull();
    expect(await prisma.deletedItem.count({ where: { accountId: m.id } })).toBe(1);
    expect((await dav("DELETE", "/dav/", token)).status).toBe(403);
    expect((await dav("DELETE", "/dav/missing.txt", token)).status).toBe(404);
  });

  it("hands out advisory locks and accepts property updates", async () => {
    const m = await member();
    await tree(m);
    const token = await tokenFor(m, ["files:read", "files:write"]);
    const locked = await dav("LOCK", "/dav/notes.txt", token, { timeout: "Second-600" });
    expect(locked.status).toBe(200);
    const lockToken = locked.headers.get("lock-token");
    expect(lockToken).toMatch(/^<opaquelocktoken:[0-9a-f-]+>$/);
    expect(await locked.text()).toContain("<D:timeout>Second-600</D:timeout>");
    const refreshed = await dav("LOCK", "/dav/notes.txt", token, { if: `(${lockToken})` });
    expect(refreshed.headers.get("lock-token")).toBe(lockToken);
    expect((await dav("UNLOCK", "/dav/notes.txt", token, { "lock-token": lockToken! })).status).toBe(204);

    // Locking a new name reserves it with an empty file, as Finder expects.
    expect((await dav("LOCK", "/dav/new.txt", token)).status).toBe(201);
    expect((await child(m.rootId, "new.txt"))?.size).toBe(0n);
    expect((await dav("PROPPATCH", "/dav/notes.txt", token, {}, '<D:propertyupdate xmlns:D="DAV:"/>')).status).toBe(207);
  });
});

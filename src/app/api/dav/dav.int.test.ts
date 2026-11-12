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

function dav(method: string, path: string, token: string | null, headers: Record<string, string> = {}) {
  return davHandler(new Request(`http://localhost${path}`, { method, headers: { ...(token ? { authorization: basic(token) } : {}), ...headers } }));
}

/** Docs/ (folder) with "a b.txt" inside, and notes.txt at the top. */
async function tree(m: FixtureMember) {
  const docs = newNodeId();
  await prisma.node.create({ data: { id: docs, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Docs", linkId: newLinkId() } });
  await addFile(m, docs, ["Docs"], "a b.txt", "inside", "text/plain");
  await addFile(m, m.rootId, [], "notes.txt", "hello dav", "text/plain");
}

describe("webdav (read-only)", () => {
  it("answers OPTIONS without a token and asks for one otherwise", async () => {
    const options = await dav("OPTIONS", "/dav/", null);
    expect(options.status).toBe(200);
    expect(options.headers.get("dav")).toBe("1");
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

  it("downloads files with Range, and refuses writes, folders and missing paths", async () => {
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
    expect((await dav("PUT", "/dav/new.txt", token)).status).toBe(405);
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

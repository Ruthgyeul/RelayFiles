import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET as listTokens, POST as createToken } from "@/app/api/me/api-tokens/route";
import { DELETE as revokeToken } from "@/app/api/me/api-tokens/[id]/route";
import { GET as download } from "@/app/api/v1/files/[id]/route";
import { POST as upload } from "@/app/api/v1/files/route";
import { GET as folder } from "@/app/api/v1/folders/[id]/route";
import { POST as createFolder } from "@/app/api/v1/folders/route";
import { GET as me } from "@/app/api/v1/me/route";
import { DELETE as deleteNode } from "@/app/api/v1/nodes/[id]/route";
import { API } from "@/config/policy";
import type { ApiScope, ApiTokenDto, ApiV1Account, ApiV1UploadedFile, CreatedApiToken } from "@/contracts/api-tokens";
import type { CreatedFolder, FolderView } from "@/contracts/nodes";
import { runCleanup } from "@/server/services/admin.service";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

interface V1Options<P> {
  method?: string;
  token?: string;
  query?: string;
  params?: P;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

/** Calls an /api/v1 handler the way a script would: Bearer token, no cookies unless given. */
async function v1<P = Record<string, never>>(handler: Handler<P>, options: V1Options<P> = {}) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (typeof options.body === "string") headers.set("content-type", "application/json");
  if (Buffer.isBuffer(options.body) && !headers.has("content-length")) headers.set("content-length", String(options.body.length));
  const req = new NextRequest(`http://localhost/api/v1/test${options.query ?? ""}`, { method: options.method ?? "GET", headers, body: Buffer.isBuffer(options.body) ? new Uint8Array(options.body) : options.body });
  return handler(req, { params: Promise.resolve((options.params ?? {}) as P) });
}

const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

async function tokenFor(m: FixtureMember, scopes: ApiScope[], expiresInDays: number | null = API.expiryDays[0]) {
  const res = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "script", scopes, expiresInDays } });
  expect(res.status).toBe(201);
  return res.json.data;
}

describe("personal API tokens", () => {
  it("creates, lists and revokes a token; the token itself is shown only on creation", async () => {
    const m = await member();
    const created = await tokenFor(m, ["files:read"]);
    expect(created.token).toMatch(/^rfp_[A-Za-z0-9_-]{43}$/);
    const listed = await callRoute<ApiTokenDto[]>(listTokens, { cookie: m.cookie });
    expect(listed.json.data).toEqual([created.item]);
    expect(JSON.stringify(listed.json.data)).not.toContain(created.token);
    expect((await v1(me, { token: created.token })).status).toBe(200);

    expect((await callRoute(revokeToken, { method: "DELETE", cookie: m.cookie, params: { id: created.item.id } })).status).toBe(200);
    expect((await v1(me, { token: created.token })).status).toBe(401);
    const audit = await prisma.auditEvent.findMany({ where: { actorId: m.id, action: { startsWith: "apiToken." } }, orderBy: { at: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["apiToken.create", "apiToken.revoke"]);
  });

  it("keeps metrics:read to admins and other accounts' tokens out of reach", async () => {
    const m = await member();
    const other = await member();
    const refused = await callRoute(createToken, { method: "POST", cookie: m.cookie, body: { name: "metrics", scopes: ["metrics:read"], expiresInDays: null } });
    expect(refused.status).toBe(403);
    const created = await tokenFor(other, ["files:read"]);
    expect((await callRoute(revokeToken, { method: "DELETE", cookie: m.cookie, params: { id: created.item.id } })).status).toBe(404);
  });

  it("refuses missing, wrong and expired tokens, missing scopes, and session cookies", async () => {
    const m = await member();
    const reader = await tokenFor(m, ["files:read"]);
    expect((await v1(me)).status).toBe(401);
    expect((await v1(me, { token: `${reader.token.slice(0, -1)}x` })).status).toBe(401);
    expect((await v1(me, { headers: { cookie: `${SESSION_COOKIE}=${m.cookie}` } })).status).toBe(401);
    const denied = await v1(createFolder, { method: "POST", token: reader.token, body: JSON.stringify({ parentId: "root", name: "x" }) });
    expect(denied.status).toBe(403);

    await prisma.apiToken.update({ where: { id: reader.item.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await v1(me, { token: reader.token })).status).toBe(401);
    await runCleanup(new Date());
    expect(await prisma.apiToken.count({ where: { id: reader.item.id } })).toBe(0);
  });

  it("limits requests per token per minute", async () => {
    const m = await member();
    const { token } = await tokenFor(m, ["files:read"]);
    for (let i = 0; i < API.requestsPerMinute; i++) expect((await v1(me, { token })).status).toBe(200);
    const limited = await v1(me, { token });
    expect(limited.status).toBe(429);
  });
});

describe("API v1", () => {
  it("uploads a whole-body file, lists, downloads and deletes it", async () => {
    const m = await member();
    const { token } = await tokenFor(m, ["files:read", "files:write"]);
    const account = await data<ApiV1Account>(await v1(me, { token }));
    expect(account).toMatchObject({ id: m.id, usedBytes: "0", scopes: ["files:read", "files:write"] });

    const made = await v1(createFolder, { method: "POST", token, body: JSON.stringify({ parentId: "root", name: "Shots" }) });
    expect(made.status).toBe(201);
    const shots = (await data<CreatedFolder>(made)).folder;

    const bytes = Buffer.from("screenshot bytes");
    const sent = await v1(upload, { method: "POST", token, query: `?folder=${shots.id}&name=shot.png`, body: bytes });
    expect(sent.status, JSON.stringify(await sent.clone().json())).toBe(201);
    const file = await data<ApiV1UploadedFile>(sent);
    expect(file).toMatchObject({ name: "shot.png", folderId: shots.id });
    expect(file.url).toMatch(new RegExp(`/d/${file.linkId}$`));
    expect(await readFile(join(m.dir, "Shots", "shot.png"), "utf8")).toBe("screenshot bytes");

    const again = await data<ApiV1UploadedFile>(await v1(upload, { method: "POST", token, query: `?folder=${shots.id}&name=shot.png`, body: bytes }));
    expect(again.name).toBe("shot (2).png");

    const view = await data<FolderView>(await v1(folder, { token, params: { id: shots.id } }));
    expect(view.children.map((child) => child.name).sort()).toEqual(["shot (2).png", "shot.png"]);

    const got = await v1(download, { token, params: { id: file.nodeId } });
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("screenshot bytes");

    expect((await v1(deleteNode, { method: "DELETE", token, params: { id: shots.id } })).status).toBe(200);
    expect((await v1(download, { token, params: { id: file.nodeId } })).status).toBe(404);
  });

  it("refuses a body longer than its Content-Length, a bad name and another account's folder", async () => {
    const m = await member();
    const other = await member();
    const { token } = await tokenFor(m, ["files:write"]);
    const long = await v1(upload, { method: "POST", token, query: "?name=a.txt", body: Buffer.from("0123456789"), headers: { "content-length": "4" } });
    expect(long.status).toBe(400);
    expect(await prisma.node.count({ where: { accountId: m.id, name: "a.txt" } })).toBe(0);
    expect((await v1(upload, { method: "POST", token, query: "?name=a%2Fb", body: Buffer.from("x") })).status).toBe(400);
    const theirs = await addFile(other, other.rootId, [], "theirs.txt", "x", "text/plain");
    expect((await v1(download, { token: (await tokenFor(m, ["files:read"])).token, params: { id: theirs } })).status).toBe(404);
    expect((await v1(upload, { method: "POST", token, query: `?folder=${other.rootId}&name=b.txt`, body: Buffer.from("x") })).status).toBe(404);
  });
});

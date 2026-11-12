import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import type { PrepareUploadResult } from "@/contracts/uploads";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../test/file-fixtures";
import { POST as prepare } from "./route";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

const b64 = (value: string) => Buffer.from(value).toString("base64");

async function tokenFor(m: FixtureMember, scopes = ["files:read", "files:write"]) {
  const res = await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "cli", scopes, expiresInDays: null } });
  return res.json.data.token;
}

async function plan(token: string, files: { rel: string; size: number }[], dup?: "replace") {
  const req = new NextRequest("http://localhost/api/v1/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ files, ...(dup ? { dup } : {}) }),
  });
  const res = await prepare(req, { params: Promise.resolve({}) });
  return { status: res.status, data: ((await res.json()) as { data: PrepareUploadResult }).data };
}

function tusCall(method: "POST" | "PATCH" | "HEAD", url: string, token: string | null, headers: Record<string, string>, body?: Buffer) {
  const req = new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "tus-resumable": "1.0.0", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? new Uint8Array(body) : undefined,
  });
  return tus[method](req, { params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }) });
}

/** Creates the tus upload of one file of a ready batch; returns its URL. */
async function create(token: string | null, ready: Extract<PrepareUploadResult, { kind: "ready" }>, name: string, size: number) {
  return tusCall("POST", ready.endpoint, token, { "upload-length": String(size), "upload-metadata": `batch ${b64(ready.batchId)},index ${b64("0")},filename ${b64(name)}` });
}

const patch = (url: string, token: string | null, content: string) => tusCall("PATCH", url, token, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));

describe("API v1 resumable uploads", () => {
  it("plans a batch and takes its file over tus with the same token", async () => {
    const m = await member();
    const token = await tokenFor(m);
    const planned = await plan(token, [{ rel: "big.bin", size: 5 }]);
    expect(planned.status).toBe(200);
    if (planned.data.kind !== "ready") throw new Error("not ready");
    const created = await create(token, planned.data, "big.bin", 5);
    expect(created.status).toBe(201);
    const url = created.headers.get("location")!.replace(/^https?:\/\/[^/]+/, "");
    const done = await patch(url, token, "hello");
    expect(done.status).toBe(200);
    const node = await prisma.node.findFirstOrThrow({ where: { accountId: m.id, name: "big.bin" } });
    expect(node.size).toBe(5n);
  });

  it("refuses the upload to anyone but the token that planned it", async () => {
    const m = await member();
    const token = await tokenFor(m);
    const other = await tokenFor(m);
    const planned = await plan(token, [{ rel: "a.txt", size: 3 }]);
    if (planned.data.kind !== "ready") throw new Error("not ready");
    expect((await create(null, planned.data, "a.txt", 3)).status).toBe(401);
    expect((await create(other, planned.data, "a.txt", 3)).status).toBe(404);

    const created = await create(token, planned.data, "a.txt", 3);
    const url = created.headers.get("location")!.replace(/^https?:\/\/[^/]+/, "");
    expect((await patch(url, other, "abc")).status).toBe(404);
    expect((await patch(url, null, "abc")).status).toBe(401);
    expect((await patch(url, token, "abc")).status).toBe(200);
  });

  it("asks about taken names and replaces with dup, keeping a version", async () => {
    const m = await member();
    const token = await tokenFor(m);
    const first = await plan(token, [{ rel: "notes.txt", size: 3 }]);
    if (first.data.kind !== "ready") throw new Error("not ready");
    const created = await create(token, first.data, "notes.txt", 3);
    await patch(created.headers.get("location")!.replace(/^https?:\/\/[^/]+/, ""), token, "one");

    expect((await plan(token, [{ rel: "notes.txt", size: 3 }])).data).toEqual({ kind: "duplicates", names: ["notes.txt"] });
    const again = await plan(token, [{ rel: "notes.txt", size: 3 }], "replace");
    if (again.data.kind !== "ready") throw new Error("not ready");
    const second = await create(token, again.data, "notes.txt", 3);
    expect((await patch(second.headers.get("location")!.replace(/^https?:\/\/[^/]+/, ""), token, "two")).status).toBe(200);
    const node = await prisma.node.findFirstOrThrow({ where: { accountId: m.id, name: "notes.txt" } });
    expect(await prisma.fileVersion.count({ where: { nodeId: node.id } })).toBe(1);
  });

  it("needs files:write", async () => {
    const m = await member();
    expect((await plan(await tokenFor(m, ["files:read"]), [{ rel: "x", size: 1 }])).status).toBe(403);
  });
});

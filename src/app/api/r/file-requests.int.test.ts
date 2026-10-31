import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET as listRequests, POST as createRequest } from "@/app/api/file-requests/route";
import { DELETE as deleteRequest } from "@/app/api/file-requests/[id]/route";
import { GET as view } from "@/app/api/r/[id]/route";
import { POST as unlock } from "@/app/api/r/[id]/unlock/route";
import { POST as prepare } from "@/app/api/r/[id]/uploads/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import type { FileRequestDto, FileRequestView, RequestUploadPlan } from "@/contracts/file-requests";
import { UNLOCK_COOKIE } from "@/server/share/unlock-cookie";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const b64 = (value: string) => Buffer.from(value).toString("base64");

interface Visitor {
  ip: string;
  /** The visitor's `rf_sh` cookie once a password was entered. */
  unlock?: string;
}

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

/** A visitor's call: no session, only the unlock cookie. */
async function visit<T>(handler: Handler<{ id: string }>, id: string, visitor: Visitor, body?: unknown) {
  const headers = new Headers({ "content-type": "application/json", "x-real-ip": visitor.ip });
  if (visitor.unlock) headers.set("cookie", `${UNLOCK_COOKIE}=${visitor.unlock}`);
  const req = new NextRequest(`http://localhost/api/r/${id}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve({ id }) });
  const cookie = res.headers.getSetCookie().find((line) => line.startsWith(`${UNLOCK_COOKIE}=`));
  if (cookie) visitor.unlock = cookie.split(";")[0]!.slice(UNLOCK_COOKIE.length + 1);
  return { status: res.status, json: (await res.json()) as { data: T; error?: string } };
}

async function tusCall(method: "POST" | "PATCH", url: string, visitor: Visitor, headers: Record<string, string>, body?: Buffer) {
  const all: Record<string, string> = { "tus-resumable": "1.0.0", ...headers };
  if (visitor.unlock) all.cookie = `${UNLOCK_COOKIE}=${visitor.unlock}`;
  const req = new NextRequest(`http://localhost${url}`, { method, headers: all, body: body ? new Uint8Array(body) : undefined });
  return tus[method](req, { params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }) });
}

/** Starts one file of a visitor batch (tus create); returns the response and the upload URL. */
async function start(plan: RequestUploadPlan, visitor: Visitor, slot: number, name: string, size: number) {
  const created = await tusCall("POST", plan.endpoint, visitor, { "upload-length": String(size), "upload-metadata": `batch ${b64(plan.batchId)},index ${b64(String(slot))},filename ${b64(name)}` });
  return { created, url: `${plan.endpoint}/${created.headers.get("location")?.split("/").pop()}` };
}

async function send(plan: RequestUploadPlan, visitor: Visitor, slot: number, name: string, content: string) {
  const { created, url } = await start(plan, visitor, slot, name, Buffer.byteLength(content));
  expect(created.status, await created.clone().text()).toBe(201);
  const patched = await tusCall("PATCH", url, visitor, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));
  return { status: patched.status, body: patched.status === 200 ? ((await patched.json()) as { data: unknown }).data : await patched.text() };
}

async function requestFor(m: FixtureMember, body: Partial<Record<string, unknown>> = {}) {
  const res = await callRoute<FileRequestDto>(createRequest, { method: "POST", cookie: m.cookie, body: { folderId: "root", title: "Trip photos", password: null, expiresInDays: null, maxFiles: null, maxMb: null, ...body } });
  expect(res.status).toBe(201);
  return res.json.data;
}

describe("upload-only links", () => {
  it("lets a visitor add files without seeing the folder, and counts them", async () => {
    const m = await member();
    await addFile(m, m.rootId, [], "secret.txt", "private", "text/plain");
    const request = await requestFor(m, { maxFiles: 5 });
    expect(request.url).toMatch(new RegExp(`/r/${request.id}$`));
    const visitor: Visitor = { ip: randomTestIp() };

    const shown = await visit<FileRequestView>(view, request.id, visitor);
    expect(shown.json.data).toMatchObject({ status: "open", title: "Trip photos", filesLeft: 5, bytesLeft: null });
    expect(JSON.stringify(shown.json.data)).not.toContain("secret.txt");
    expect(JSON.stringify(shown.json.data)).not.toContain(m.rootId);

    const plan = (await visit<RequestUploadPlan>(prepare, request.id, visitor, { files: [{ name: "a.jpg", size: 3 }, { name: "secret.txt", size: 4 }] })).json.data;
    expect(await send(plan, visitor, 0, "a.jpg", "abc")).toEqual({ status: 200, body: { name: "a.jpg" } });
    expect(await send(plan, visitor, 1, "secret.txt", "mine")).toEqual({ status: 200, body: { name: "secret (2).txt" } });
    expect(await readFile(join(m.dir, "secret.txt"), "utf8")).toBe("private");
    expect(await readFile(join(m.dir, "secret (2).txt"), "utf8")).toBe("mine");

    const [listed] = (await callRoute<FileRequestDto[]>(listRequests, { cookie: m.cookie, query: "?folder=root" })).json.data;
    expect(listed).toMatchObject({ id: request.id, filesReceived: 2, bytesReceived: "7", status: "open" });
  });

  it("asks for the password before showing the form or taking files", async () => {
    const m = await member();
    const request = await requestFor(m, { password: "hunter2" });
    const visitor: Visitor = { ip: randomTestIp() };
    expect((await visit<FileRequestView>(view, request.id, visitor)).json.data.status).toBe("locked");
    expect((await visit(prepare, request.id, visitor, { files: [{ name: "a.txt", size: 1 }] })).status).toBe(401);
    expect((await visit(unlock, request.id, visitor, { password: "wrong" })).status).toBe(403);
    expect((await visit(unlock, request.id, visitor, { password: "hunter2" })).status).toBe(200);
    expect((await visit<FileRequestView>(view, request.id, visitor)).json.data.status).toBe("open");

    const plan = (await visit<RequestUploadPlan>(prepare, request.id, visitor, { files: [{ name: "a.txt", size: 1 }] })).json.data;
    // Another device with the batch id but without the password cannot send its files.
    const stranger: Visitor = { ip: randomTestIp() };
    expect((await start(plan, stranger, 0, "a.txt", 1)).created.status).toBe(401);
    expect((await send(plan, visitor, 0, "a.txt", "x")).status).toBe(200);
  });

  it("keeps to its file count even when uploads start together", async () => {
    const m = await member();
    const request = await requestFor(m, { maxFiles: 1 });
    const visitor: Visitor = { ip: randomTestIp() };
    expect((await visit(prepare, request.id, visitor, { files: [{ name: "a", size: 1 }, { name: "b", size: 1 }] })).status).toBe(400);
    const first = (await visit<RequestUploadPlan>(prepare, request.id, visitor, { files: [{ name: "a", size: 1 }] })).json.data;
    const second = (await visit<RequestUploadPlan>(prepare, request.id, visitor, { files: [{ name: "b", size: 1 }] })).json.data;
    const [one, two] = await Promise.all([start(first, visitor, 0, "a", 1), start(second, visitor, 0, "b", 1)]);
    expect([one.created.status, two.created.status].sort()).toEqual([201, 410]);
  });

  it("keeps to its size limit", async () => {
    const m = await member();
    const request = await requestFor(m, { maxMb: 1 });
    const visitor: Visitor = { ip: randomTestIp() };
    const res = await visit(prepare, request.id, visitor, { files: [{ name: "big.bin", size: 1_000_001 }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("This link accepts 1.0 MB more.");
  });

  it("stops taking files once expired or deleted, and only its owner can delete it", async () => {
    const m = await member();
    const other = await member();
    const request = await requestFor(m, { expiresInDays: 1 });
    const visitor: Visitor = { ip: randomTestIp() };
    expect((await callRoute(deleteRequest, { method: "DELETE", cookie: other.cookie, params: { id: request.id } })).status).toBe(404);

    await prisma.fileRequest.update({ where: { id: request.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await visit<FileRequestView>(view, request.id, visitor)).json.data.status).toBe("expired");
    expect((await visit(prepare, request.id, visitor, { files: [{ name: "a", size: 1 }] })).status).toBe(410);

    expect((await callRoute(deleteRequest, { method: "DELETE", cookie: m.cookie, params: { id: request.id } })).status).toBe(200);
    expect((await visit(view, request.id, visitor)).status).toBe(404);
  });

  it("refuses another account's folder", async () => {
    const m = await member();
    const other = await member();
    const res = await callRoute(createRequest, { method: "POST", cookie: m.cookie, body: { folderId: other.rootId, title: "x", password: null, expiresInDays: null, maxFiles: null, maxMb: null } });
    expect(res.status).toBe(404);
  });
});

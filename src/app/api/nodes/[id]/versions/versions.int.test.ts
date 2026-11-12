import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { GET as listTrash } from "@/app/api/trash/route";
import { POST as restoreTrash } from "@/app/api/trash/[id]/restore/route";
import { POST as prepare } from "@/app/api/uploads/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import { GET as v1Versions } from "@/app/api/v1/files/[id]/versions/route";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import type { CreatedAccount } from "@/contracts/auth";
import type { FileVersionDto } from "@/contracts/nodes";
import type { DeletedItemDto } from "@/contracts/trash";
import type { PrepareUploadResult, UploadedFile } from "@/contracts/uploads";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { accountVersionBytes } from "@/server/repositories/file-version.repo";
import { purgeExpiredVersions } from "@/server/services/file-version.service";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { callRoute, callRouteRaw } from "../../../../../../test/route-call";
import { randomTestIp } from "../../../../../../test/file-fixtures";
import { DELETE as deleteVersion } from "./[vid]/route";
import { GET as versionContent } from "./[vid]/content/route";
import { POST as restoreVersion } from "./[vid]/restore/route";
import { GET as listVersions } from "./route";

const prisma = db();
const accounts: string[] = [];

afterAll(async () => {
  for (const id of accounts) {
    await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
    await rm(join(layoutOf(configuredVolumeRoot()).versions, id), { recursive: true, force: true });
  }
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

async function member() {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
  accounts.push(res.json.data.account.id);
  return { id: res.json.data.account.id, cookie: res.cookie!, root: userRootOf(configuredVolumeRoot(), res.json.data.account.id) };
}
type Session = Awaited<ReturnType<typeof member>>;
const b64 = (value: string) => Buffer.from(value).toString("base64");

async function tusCall(method: "POST" | "PATCH", url: string, cookie: string, headers: Record<string, string>, body?: Buffer) {
  const req = new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "tus-resumable": "1.0.0", cookie: `${SESSION_COOKIE}=${cookie}`, ...headers },
    body: body ? new Uint8Array(body) : undefined,
  });
  return tus[method](req, { params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }) });
}

/** Uploads one file to the root (replacing a file of the same name when there is one); returns its node id. */
async function upload(s: Session, name: string, content: string): Promise<string> {
  const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", dup: "replace", files: [{ rel: name, size: Buffer.byteLength(content) }] } });
  const plan = res.json.data;
  if (plan.kind !== "ready") throw new Error(`upload not ready: ${JSON.stringify(plan)}`);
  const created = await tusCall("POST", plan.endpoint, s.cookie, {
    "upload-length": String(Buffer.byteLength(content)),
    "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")},filename ${b64(name)}`,
  });
  const id = created.headers.get("location")!.split("/").pop()!;
  const patched = await tusCall("PATCH", `${plan.endpoint}/${id}`, s.cookie, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));
  expect(patched.status).toBe(200);
  return ((await patched.json()) as { data: UploadedFile }).data.nodeId;
}

const versionsOf = async (s: Session, id: string) => (await callRoute<FileVersionDto[], { id: string }>(listVersions, { cookie: s.cookie, params: { id } })).json.data;
const versionFile = (s: Session, vid: string) => join(layoutOf(configuredVolumeRoot()).versions, s.id, vid);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("file versions", () => {
  it("keeps the replaced content as a version that counts toward storage and can be downloaded", async () => {
    const s = await member();
    await upload(s, "notes.txt", "first draft");
    const id = await upload(s, "notes.txt", "second draft!");
    const versions = await versionsOf(s, id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ size: String(Buffer.byteLength("first draft")), mime: "text/plain" });
    expect(Date.parse(versions[0]!.expiresAt) - Date.parse(versions[0]!.replacedAt)).toBe(getEnv("storage").FILE_VERSIONS_DAYS * MS.day);
    expect(await readFile(versionFile(s, versions[0]!.id), "utf8")).toBe("first draft");
    expect(await readFile(join(s.root, "notes.txt"), "utf8")).toBe("second draft!");
    expect(await accountVersionBytes(prisma, s.id)).toBe(BigInt(Buffer.byteLength("first draft")));

    const res = await callRouteRaw<{ id: string; vid: string }>(versionContent, { cookie: s.cookie, params: { id, vid: versions[0]!.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("notes.txt");
    expect(await res.text()).toBe("first draft");

    // A third upload keeps both earlier versions, newest first.
    const third = await upload(s, "notes.txt", "third");
    expect((await versionsOf(s, third)).map((version) => version.size)).toEqual([String(Buffer.byteLength("second draft!")), String(Buffer.byteLength("first draft"))]);
  });

  it("restores a version: the current content becomes a version and the share link stays", async () => {
    const s = await member();
    await upload(s, "plan.txt", "v1");
    const id = await upload(s, "plan.txt", "v2 content");
    const before = await prisma.node.findUniqueOrThrow({ where: { id } });
    await prisma.node.update({ where: { id }, data: { tags: ["keep"] } });
    const [v1] = await versionsOf(s, id);
    const res = await callRoute<{ nodeId: string }, { id: string; vid: string }>(restoreVersion, { method: "POST", cookie: s.cookie, params: { id, vid: v1!.id } });
    expect(res.status).toBe(200);
    const restored = await prisma.node.findUniqueOrThrow({ where: { id: res.json.data.nodeId } });
    expect(restored.id).not.toBe(id);
    expect({ name: restored.name, linkId: restored.linkId, tags: restored.tags, size: restored.size }).toEqual({ name: "plan.txt", linkId: before.linkId, tags: ["keep"], size: 2n });
    expect(await readFile(join(s.root, "plan.txt"), "utf8")).toBe("v1");
    const now = await versionsOf(s, restored.id);
    expect(now).toHaveLength(1);
    expect(await readFile(versionFile(s, now[0]!.id), "utf8")).toBe("v2 content");
    expect(await exists(versionFile(s, v1!.id))).toBe(false);
    expect(await prisma.node.count({ where: { id } })).toBe(0);
  });

  it("deletes a version for good and keeps other accounts out", async () => {
    const s = await member();
    const other = await member();
    await upload(s, "a.txt", "old");
    const id = await upload(s, "a.txt", "new");
    const [version] = await versionsOf(s, id);
    const params = { id, vid: version!.id };
    expect((await callRoute(listVersions, { cookie: other.cookie, params: { id } })).status).toBe(404);
    expect((await callRouteRaw(versionContent, { cookie: other.cookie, params })).status).toBe(404);
    expect((await callRoute(restoreVersion, { method: "POST", cookie: other.cookie, params })).status).toBe(404);
    expect((await callRoute(deleteVersion, { method: "DELETE", cookie: other.cookie, params })).status).toBe(404);

    expect((await callRoute(deleteVersion, { method: "DELETE", cookie: s.cookie, params })).status).toBe(200);
    expect(await versionsOf(s, id)).toEqual([]);
    expect(await exists(versionFile(s, version!.id))).toBe(false);
    expect(await accountVersionBytes(prisma, s.id)).toBe(0n);
  });

  it("keeps versions of a deleted file until they expire, and brings them back with the file", async () => {
    const s = await member();
    await upload(s, "doc.txt", "draft");
    const id = await upload(s, "doc.txt", "final");
    expect((await callRoute(remove, { method: "POST", cookie: s.cookie, body: { ids: [id] } })).status).toBe(200);
    expect(await prisma.fileVersion.count({ where: { nodeId: id } })).toBe(1);
    const [deleted] = (await callRoute<DeletedItemDto[]>(listTrash, { cookie: s.cookie })).json.data;
    expect((await callRoute(restoreTrash, { method: "POST", cookie: s.cookie, params: { id: deleted!.id } })).status).toBe(200);
    expect(await versionsOf(s, id)).toHaveLength(1);
  });

  it("removes versions older than FILE_VERSIONS_DAYS, bytes and rows", async () => {
    const s = await member();
    await upload(s, "x.txt", "one");
    const id = await upload(s, "x.txt", "two");
    await upload(s, "y.txt", "keep");
    const keptId = await upload(s, "y.txt", "keep 2");
    const [old] = await versionsOf(s, id);
    const [fresh] = await versionsOf(s, keptId);
    await prisma.fileVersion.update({ where: { id: old!.id }, data: { createdAt: new Date(Date.now() - (getEnv("storage").FILE_VERSIONS_DAYS + 1) * MS.day) } });
    expect(await purgeExpiredVersions(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileVersion.count({ where: { id: old!.id } })).toBe(0);
    expect(await exists(versionFile(s, old!.id))).toBe(false);
    expect(await exists(versionFile(s, fresh!.id))).toBe(true);
  });

  it("sends replaced files to the trash instead when FILE_VERSIONS_DAYS is 0", async () => {
    const s = await member();
    const env = getEnv("storage") as { FILE_VERSIONS_DAYS: number };
    const days = env.FILE_VERSIONS_DAYS;
    env.FILE_VERSIONS_DAYS = 0;
    try {
      await upload(s, "z.txt", "gone");
      const id = await upload(s, "z.txt", "here");
      expect(await versionsOf(s, id)).toEqual([]);
      expect((await prisma.trashedBytes.aggregate({ where: { accountId: s.id }, _sum: { bytes: true } }))._sum.bytes).toBe(4n);
    } finally {
      env.FILE_VERSIONS_DAYS = days;
    }
  });

  it("lists versions over API v1", async () => {
    const s = await member();
    await upload(s, "api.txt", "a");
    const id = await upload(s, "api.txt", "b");
    const token = (await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: s.cookie, body: { name: "cli", scopes: ["files:read"], expiresInDays: null } })).json.data.token;
    const req = new NextRequest(`http://localhost/api/v1/files/${id}/versions`, { headers: { authorization: `Bearer ${token}` } });
    const res = await v1Versions(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: FileVersionDto[] }).data).toHaveLength(1);
  });
});

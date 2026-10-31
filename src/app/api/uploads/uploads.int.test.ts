import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { GET as getFolder } from "@/app/api/folders/[id]/route";
import { POST as createFolder } from "@/app/api/folders/route";
import { GET as duplicates } from "@/app/api/nodes/[id]/duplicates/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { POST as prepare } from "@/app/api/uploads/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import type { CreatedAccount } from "@/contracts/auth";
import { STORAGE } from "@/config/policy";
import type { CreatedFolder, DuplicatesResult, FolderView } from "@/contracts/nodes";
import type { PrepareUploadResult, UploadedFile } from "@/contracts/uploads";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { randomTestIp } from "../../../../test/file-fixtures";
import { callRoute } from "../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];

async function member() {
  // Each from its own address: anonymous sign-ups are limited per address and hour.
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
  accounts.push(res.json.data.account.id);
  return { id: res.json.data.account.id, cookie: res.cookie!, root: userRootOf(configuredVolumeRoot(), res.json.data.account.id) };
}

type Session = Awaited<ReturnType<typeof member>>;
const b64 = (value: string) => Buffer.from(value).toString("base64");

async function tusCall(method: "POST" | "PATCH" | "HEAD" | "DELETE", url: string, cookie: string, headers: Record<string, string>, body?: Buffer) {
  const req = new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "tus-resumable": "1.0.0", cookie: `${SESSION_COOKIE}=${cookie}`, ...headers },
    body: body ? new Uint8Array(body) : undefined,
  });
  const path = url.replace("/api/uploads/tus/", "").split("/");
  return tus[method](req, { params: Promise.resolve({ path }) });
}

/** Sends one file through tus: create, then a single PATCH with the whole body. */
async function sendFile(s: Session, endpoint: string, batchId: string, slot: number, name: string, content: string, lastModified?: number) {
  const created = await tusCall("POST", endpoint, s.cookie, {
    "upload-length": String(Buffer.byteLength(content)),
    "upload-metadata": `batch ${b64(batchId)},index ${b64(String(slot))},filename ${b64(name)}${lastModified === undefined ? "" : `,lastModified ${b64(String(lastModified))}`}`,
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const location = created.headers.get("location")!;
  const id = location.split("/").pop()!;
  const patched = await tusCall("PATCH", `${endpoint}/${id}`, s.cookie, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));
  return { status: patched.status, file: patched.status === 200 ? ((await patched.json()) as { data: UploadedFile }).data : null, id };
}

async function upload(s: Session, target: string, files: { rel: string; content: string; lastModified?: number }[], dup?: "replace" | "keep" | "skip") {
  const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target, dup, files: files.map((f) => ({ rel: f.rel, size: Buffer.byteLength(f.content) })), fallbackName: "Upload Oct 6, 9:00 AM" } });
  const plan = res.json.data;
  if (res.status !== 200 || plan.kind !== "ready") return { status: res.status, plan, sent: [] };
  const sent = [];
  for (const [slot, file] of plan.files.entries()) sent.push(await sendFile(s, plan.endpoint, plan.batchId, slot, file.rel.split("/").pop()!, files[file.index]!.content, files[file.index]!.lastModified));
  return { status: res.status, plan, sent };
}

const list = async (s: Session, id = "root") => (await callRoute<FolderView, { id: string }>(getFolder, { cookie: s.cookie, params: { id } })).json.data;

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("uploads", () => {
  it("records the file's own modification time, or the upload time without one", async () => {
    const s = await member();
    const before = Date.now();
    const { sent } = await upload(s, "root", [
      { rel: "old.txt", content: "a", lastModified: Date.UTC(2020, 0, 2) },
      { rel: "none.txt", content: "b" },
      { rel: "future.txt", content: "c", lastModified: Date.now() + 86_400_000 },
    ]);
    expect(sent.map((r) => r.status)).toEqual([200, 200, 200]);
    const rows = await prisma.node.findMany({ where: { accountId: s.id, type: "FILE" }, select: { name: true, modifiedAt: true } });
    const at = (name: string) => rows.find((row) => row.name === name)!.modifiedAt!.getTime();
    expect(at("old.txt")).toBe(Date.UTC(2020, 0, 2));
    for (const name of ["none.txt", "future.txt"]) expect(at(name)).toBeGreaterThanOrEqual(before);
    expect((await list(s)).children.find((child) => child.name === "old.txt")?.modifiedAt).toBe("2020-01-02T00:00:00.000Z");
  });

  it("finds files with the same content in a folder and its subfolders", async () => {
    const s = await member();
    const { sent } = await upload(s, "root", [
      { rel: "a.jpg", content: "same" },
      { rel: "b.jpg", content: "same" },
      { rel: "Trip/c.jpg", content: "same" },
      { rel: "Trip/d.jpg", content: "other" },
      { rel: "e.jpg", content: "diff" },
    ]);
    expect(sent.every((r) => r.status === 200)).toBe(true);
    const root = (await list(s)).folder.id;
    const shallow = await callRoute<DuplicatesResult, { id: string }>(duplicates, { cookie: s.cookie, params: { id: "root" }, query: "?recursive=0" });
    expect(shallow.status).toBe(200);
    expect(shallow.json.data).toMatchObject({ scanned: 3, unchecked: 0, truncated: false });
    expect(shallow.json.data.groups.map((group) => group.files.map((file) => file.name))).toEqual([["a.jpg", "b.jpg"]]);

    const deep = (await callRoute<DuplicatesResult, { id: string }>(duplicates, { cookie: s.cookie, params: { id: root }, query: "?recursive=1" })).json.data;
    expect(deep.scanned).toBe(5);
    const group = deep.groups[0]!;
    expect(group.files.map((file) => [file.name, file.folderPath, file.parentIsRoot])).toEqual([
      ["a.jpg", "", true],
      ["b.jpg", "", true],
      ["c.jpg", "Trip", false],
    ]);
    expect(group.wasted).toBe(String(2 * "same".length));

    const other = await member();
    expect((await callRoute(duplicates, { cookie: other.cookie, params: { id: root }, query: "?recursive=1" })).status).toBe(404);
  });

  it("stores files byte for byte with folders, type and checksum", async () => {
    const s = await member();
    const { plan, sent } = await upload(s, "root", [
      { rel: "notes.txt", content: "hello world" },
      { rel: "Docs/deep/readme.md", content: "# hi" },
    ]);
    expect(plan.kind).toBe("ready");
    expect(sent.map((r) => r.status)).toEqual([200, 200]);
    expect(await readFile(join(s.root, "notes.txt"), "utf8")).toBe("hello world");
    expect(await readFile(join(s.root, "Docs", "deep", "readme.md"), "utf8")).toBe("# hi");

    const row = await prisma.node.findFirstOrThrow({ where: { accountId: s.id, name: "notes.txt" } });
    expect(row).toMatchObject({ kind: "OTHER", mime: "text/plain", size: 11n, sha256: createHash("sha256").update("hello world").digest("hex") });
    const root = await list(s);
    expect(root.children.map((c) => c.name).sort()).toEqual(["Docs", "notes.txt"]);
  });

  it("stores a re-upload of the same content as a hard link, which outlives the first file", async () => {
    const s = await member();
    const first = await upload(s, "root", [{ rel: "photo.jpg", content: "same bytes" }]);
    const again = await upload(s, "root", [{ rel: "copy of photo.jpg", content: "same bytes" }, { rel: "other.jpg", content: "other bytes" }]);
    expect([...first.sent, ...again.sent].map((r) => r.status)).toEqual([200, 200, 200]);
    const [a, b, c] = await Promise.all(["photo.jpg", "copy of photo.jpg", "other.jpg"].map((name) => stat(join(s.root, name))));
    expect(b!.ino).toBe(a!.ino);
    expect(c!.ino).not.toBe(a!.ino);
    // The storage limit still counts both.
    expect((await list(s)).folder.size).toBe(String(2 * "same bytes".length + "other bytes".length));
    // No staged bytes are left behind for the linked one.
    expect((await readdir(layoutOf(configuredVolumeRoot()).uploads)).filter((name) => name === again.sent[0]!.id)).toEqual([]);

    expect((await callRoute(remove, { method: "POST", cookie: s.cookie, body: { ids: [first.sent[0]!.file!.nodeId] } })).status).toBe(200);
    expect(await readFile(join(s.root, "copy of photo.jpg"), "utf8")).toBe("same bytes");
  });

  it("names Home upload folders like the design", async () => {
    const s = await member();
    const trip = await upload(s, "home", [{ rel: "Trip/day1/a.txt", content: "a" }]);
    expect(trip.plan.kind === "ready" && trip.plan.folder.name).toBe("Trip");
    const loose = await upload(s, "home", [
      { rel: "a.txt", content: "a" },
      { rel: "b.txt", content: "b" },
    ]);
    expect(loose.plan.kind === "ready" && loose.plan.folder.name).toBe("Upload Oct 6, 9:00 AM");
    expect(await readFile(join(s.root, "Trip", "day1", "a.txt"), "utf8")).toBe("a");
  });

  it("limits the depth of Home uploads like uploads into a folder", async () => {
    const s = await member();
    const deep = Array.from({ length: STORAGE.maxFolderDepth }, (_, index) => `d${index}`).join("/");
    const res = await callRoute(prepare, { method: "POST", cookie: s.cookie, body: { target: "home", files: [{ rel: `${deep}/a.txt`, size: 1 }, { rel: "b.txt", size: 1 }] } });
    expect([res.status, res.json.error]).toEqual([400, "Folders are nested too deeply."]);
  });

  it("removes the received bytes when an upload cannot be placed", async () => {
    const s = await member();
    const target = (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: s.cookie, body: { parentId: "root", name: "Inbox" } })).json.data.folder;
    const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target: target.id, files: [{ rel: "a.txt", size: 5 }] } });
    const plan = res.json.data;
    if (plan.kind !== "ready") throw new Error("expected a ready plan");
    const created = await tusCall("POST", plan.endpoint, s.cookie, { "upload-length": "5", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    const id = created.headers.get("location")!.split("/").pop()!;
    // The folder goes away while the upload is still running.
    await callRoute(remove, { method: "POST", cookie: s.cookie, body: { ids: [target.id] } });
    const finished = await tusCall("PATCH", `${plan.endpoint}/${id}`, s.cookie, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from("hello"));
    expect(finished.status).toBeGreaterThanOrEqual(400);
    const uploads = await readdir(layoutOf(configuredVolumeRoot()).uploads);
    expect(uploads.filter((name) => name.startsWith(id))).toEqual([]);
    expect(await prisma.node.count({ where: { accountId: s.id, name: "a.txt" } })).toBe(0);
  });

  it("asks about duplicates and applies replace, keep both or skip", async () => {
    const s = await member();
    await upload(s, "root", [{ rel: "a.txt", content: "one" }]);
    const asked = await upload(s, "root", [{ rel: "a.txt", content: "two" }]);
    expect(asked.plan).toEqual({ kind: "duplicates", names: ["a.txt"] });

    await upload(s, "root", [{ rel: "a.txt", content: "two" }], "keep");
    expect(await readFile(join(s.root, "a (2).txt"), "utf8")).toBe("two");
    await upload(s, "root", [{ rel: "a.txt", content: "three" }], "replace");
    expect(await readFile(join(s.root, "a.txt"), "utf8")).toBe("three");
    expect(await prisma.node.count({ where: { accountId: s.id, name: "a.txt" } })).toBe(1);
    expect((await upload(s, "root", [{ rel: "a.txt", content: "x" }], "skip")).plan).toEqual({ kind: "nothing" });
  });

  it("enforces names, quota and upload ownership", async () => {
    const s = await member();
    expect((await upload(s, "root", [{ rel: "bad/../x.txt", content: "x" }])).status).toBe(400);
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: 5n } });
    const full = await callRoute(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", files: [{ rel: "big.txt", size: 6 }] } });
    expect(full.status).toBe(507);
    expect(full.json.error).toBe("Not enough space: 5 B left of 5 B");
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: null } });

    const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", files: [{ rel: "mine.txt", size: 4 }] } });
    const plan = res.json.data;
    if (plan.kind !== "ready") throw new Error("expected a ready plan");
    const created = await tusCall("POST", plan.endpoint, s.cookie, { "upload-length": "4", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    const id = created.headers.get("location")!.split("/").pop()!;

    const intruder = await member();
    const stolen = await tusCall("PATCH", `${plan.endpoint}/${id}`, intruder.cookie, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from("evil"));
    expect(stolen.status).toBe(404);
    const foreignBatch = await tusCall("POST", plan.endpoint, intruder.cookie, { "upload-length": "4", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    expect(foreignBatch.status).toBe(404);
    const wrongSize = await tusCall("POST", plan.endpoint, s.cookie, { "upload-length": "9", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    expect(wrongSize.status).toBe(400);
  });

  it("refuses uploads whose size is sent later than the planned one (quota bypass)", async () => {
    const s = await member();
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: 5n } });
    const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", files: [{ rel: "small.txt", size: 1 }] } });
    const plan = res.json.data;
    if (plan.kind !== "ready") throw new Error("expected a ready plan");

    const content = "far more than the five bytes this account may store";
    const created = await tusCall("POST", plan.endpoint, s.cookie, { "upload-defer-length": "1", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    if (created.status === 201) {
      const id = created.headers.get("location")!.split("/").pop()!;
      await tusCall("PATCH", `${plan.endpoint}/${id}`, s.cookie, { "upload-offset": "0", "upload-length": String(content.length), "content-type": "application/offset+octet-stream" }, Buffer.from(content));
    }

    expect(created.status).toBe(400);
    expect((await list(s)).children).toHaveLength(0);
  });

  it("reserves the space of started uploads so parallel ones cannot overrun the quota", async () => {
    const s = await member();
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: 10n } });
    // Two batches planned at once both fit on their own.
    type ReadyPlan = Extract<PrepareUploadResult, { kind: "ready" }>;
    const plans: ReadyPlan[] = [];
    for (const rel of ["one.txt", "two.txt"]) {
      const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", files: [{ rel, size: 6 }] } });
      if (res.json.data.kind !== "ready") throw new Error("expected a ready plan");
      plans.push(res.json.data);
    }
    const start = (plan: ReadyPlan) => tusCall("POST", plan.endpoint, s.cookie, { "upload-length": "6", "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")}` });
    const [first, second] = plans as [ReadyPlan, ReadyPlan];

    const started = await start(first);
    expect(started.status).toBe(201);
    const refused = await start(second);
    expect([refused.status, await refused.text()]).toEqual([507, "Not enough space: 4 B left of 10 B"]);
    // Planning another upload also counts the one in progress.
    const planned = await callRoute(prepare, { method: "POST", cookie: s.cookie, body: { target: "root", files: [{ rel: "three.txt", size: 6 }] } });
    expect(planned.status).toBe(507);

    // Cancelling gives the space back.
    const id = started.headers.get("location")!.split("/").pop()!;
    expect((await tusCall("DELETE", `${first.endpoint}/${id}`, s.cookie, {})).status).toBe(204);
    await expect.poll(async () => (await start(second)).status).toBe(201);
  });

  it("releases the reservation when an upload finishes", async () => {
    const s = await member();
    await prisma.account.update({ where: { id: s.id }, data: { quotaBytes: 10n } });
    expect((await upload(s, "root", [{ rel: "a.txt", content: "123456" }])).sent[0]!.status).toBe(200);
    // 6 bytes used, nothing pending: 4 bytes fit, 5 do not.
    expect((await upload(s, "root", [{ rel: "b.txt", content: "1234" }])).sent[0]!.status).toBe(200);
    expect((await upload(s, "root", [{ rel: "c.txt", content: "1" }])).status).toBe(507);
  });
});

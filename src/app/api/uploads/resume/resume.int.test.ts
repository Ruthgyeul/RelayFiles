import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { POST as prepare } from "@/app/api/uploads/route";
import { POST as resume } from "@/app/api/uploads/resume/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import type { CreatedAccount } from "@/contracts/auth";
import type { PrepareUploadResult, ResumedUpload, UploadedFile } from "@/contracts/uploads";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { reservedBytes } from "@/server/upload/reservations";
import { randomTestIp } from "../../../../../test/file-fixtures";
import { callRoute } from "../../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];

async function member() {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
  accounts.push(res.json.data.account.id);
  return { id: res.json.data.account.id, cookie: res.cookie! };
}

type Session = Awaited<ReturnType<typeof member>>;
type Ready = Extract<PrepareUploadResult, { kind: "ready" }>;
const b64 = (value: string) => Buffer.from(value).toString("base64");

async function tusCall(method: "POST" | "PATCH" | "HEAD", url: string, cookie: string, headers: Record<string, string>, body?: Buffer) {
  const req = new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "tus-resumable": "1.0.0", cookie: `${SESSION_COOKIE}=${cookie}`, ...headers },
    body: body ? new Uint8Array(body) : undefined,
  });
  return tus[method](req, { params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }) });
}

async function plan(s: Session, target: string, files: { rel: string; size: number }[]): Promise<Ready> {
  const res = await callRoute<PrepareUploadResult>(prepare, { method: "POST", cookie: s.cookie, body: { target, files, fallbackName: "Upload Oct 6, 9:00 AM" } });
  expect(res.status).toBe(200);
  expect(res.json.data.kind).toBe("ready");
  return res.json.data as Ready;
}

/** Creates the tus upload for `slot` and sends only the first `sent` bytes (the reload comes next). */
async function startFile(s: Session, batch: Ready, slot: number, name: string, content: Buffer, sent: number) {
  const created = await tusCall("POST", batch.endpoint, s.cookie, {
    "upload-length": String(content.length),
    "upload-metadata": `batch ${b64(batch.batchId)},index ${b64(String(slot))},filename ${b64(name)}`,
  });
  expect(created.status).toBe(201);
  const uploadId = created.headers.get("location")!.split("/").pop()!;
  const patched = await tusCall("PATCH", `${batch.endpoint}/${uploadId}`, s.cookie, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, content.subarray(0, sent));
  expect(patched.status).toBe(204);
  return uploadId;
}

const claim = (s: Session, batchId: string, slot: number, uploadId: string) => callRoute<ResumedUpload>(resume, { method: "POST", cookie: s.cookie, body: { batchId, slot, uploadId } });

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("resuming an upload after a reload", () => {
  const content = Buffer.from("0123456789abcdef");

  it("continues the earlier upload as a file of the new batch, keeping one reservation", async () => {
    const s = await member();
    const first = await plan(s, "home", [{ rel: "movie.bin", size: content.length }]);
    const uploadId = await startFile(s, first, 0, "movie.bin", content, 6);
    expect(await reservedBytes({ kind: "account", id: s.id })).toBe(BigInt(content.length));

    // After the reload the same file goes to the root, next to another file.
    const second = await plan(s, "root", [
      { rel: "notes.txt", size: 3 },
      { rel: "movie.bin", size: content.length },
    ]);
    const claimed = await claim(s, second.batchId, 1, uploadId);
    expect(claimed.status).toBe(200);
    expect(claimed.json.data).toEqual({ offset: 6 });
    // Renewed in place, not reserved a second time.
    expect(await reservedBytes({ kind: "account", id: s.id })).toBe(BigInt(content.length));

    const head = await tusCall("HEAD", `${second.endpoint}/${uploadId}`, s.cookie, {});
    expect(head.headers.get("upload-offset")).toBe("6");
    const done = await tusCall("PATCH", `${second.endpoint}/${uploadId}`, s.cookie, { "upload-offset": "6", "content-type": "application/offset+octet-stream" }, content.subarray(6));
    expect(done.status).toBe(200);
    const file = ((await done.json()) as { data: UploadedFile }).data;
    expect(file.folderId).toBe(second.folder.id);
    expect(file.name).toBe("movie.bin");

    const row = await prisma.node.findUniqueOrThrow({ where: { id: file.nodeId } });
    expect(row.size).toBe(BigInt(content.length));
    expect(await readFile(join(userRootOf(configuredVolumeRoot(), s.id), "movie.bin"))).toEqual(content);
    expect(await reservedBytes({ kind: "account", id: s.id })).toBe(0n);

    // Finished: nothing left to continue.
    const again = await plan(s, "home", [{ rel: "movie.bin", size: content.length }]);
    expect((await claim(s, again.batchId, 0, uploadId)).status).toBe(404);
  });

  it("answers 404 for another account, another size or name, and a second slot", async () => {
    const s = await member();
    const first = await plan(s, "root", [{ rel: "a.bin", size: content.length }]);
    const uploadId = await startFile(s, first, 0, "a.bin", content, 4);

    const other = await member();
    const theirs = await plan(other, "root", [{ rel: "a.bin", size: content.length }]);
    expect((await claim(other, theirs.batchId, 0, uploadId)).status).toBe(404);
    // Nor through someone else's batch.
    expect((await claim(s, theirs.batchId, 0, uploadId)).status).toBe(404);
    expect((await tusCall("HEAD", `${first.endpoint}/${uploadId}`, other.cookie, {})).status).toBe(404);

    const changed = await plan(s, "root", [
      { rel: "a.bin", size: content.length + 1 },
      { rel: "b.bin", size: content.length },
      { rel: "a.bin", size: content.length },
      { rel: "Copy/a.bin", size: content.length },
    ]);
    expect((await claim(s, changed.batchId, 0, uploadId)).status).toBe(404);
    expect((await claim(s, changed.batchId, 1, uploadId)).status).toBe(404);
    expect((await claim(s, changed.batchId, 2, uploadId)).status).toBe(200);
    // Already taken by slot 2 of this batch.
    expect((await claim(s, changed.batchId, 3, uploadId)).status).toBe(404);
    expect((await claim(s, changed.batchId, 9, uploadId)).status).toBe(404);
    expect((await claim(s, changed.batchId, 0, "f".repeat(32))).status).toBe(404);
    expect((await claim(s, changed.batchId, 0, "not-an-upload")).status).toBe(400);
  });
});

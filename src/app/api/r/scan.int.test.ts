import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRequest } from "@/app/api/file-requests/route";
import { POST as rescanRoute } from "@/app/api/nodes/[id]/scan/route";
import { POST as prepare } from "@/app/api/r/[id]/uploads/route";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { GET as trashList } from "@/app/api/trash/route";
import { POST as restore } from "@/app/api/trash/[id]/restore/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import { POST as transfer } from "@/app/api/nodes/transfer/route";
import { getEnv } from "@/config/env";
import { SCAN } from "@/config/policy";
import type { FileRequestDto, RequestUploadPlan } from "@/contracts/file-requests";
import type { DeletedItemDto } from "@/contracts/trash";
import { Queue } from "bullmq";
import { closeQueues, MEDIA_QUEUE, queueConnection } from "@/server/jobs/queue";
import { runScan } from "@/server/services/scan.service";
import { checkHealth } from "@/server/services/health.service";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, cleanup } = fileFixtures();
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** What the fake clamd answers to INSTREAM: by content (EICAR → FOUND), or a size-limit error. */
let mode: "normal" | "too-large" = "normal";
let server: Server;
const jobs = getEnv("jobs") as { CLAMAV_HOST?: string; CLAMAV_PORT: number };

/** A tiny clamd: zPING → PONG; zINSTREAM reads 4-byte length chunks until a zero length, then answers. */
function fakeClamd(): Server {
  return createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.toString("latin1").startsWith("zPING\0")) return void socket.end("PONG\0");
      const header = "zINSTREAM\0".length;
      if (buffer.length < header) return;
      let at = header;
      const parts: Buffer[] = [];
      while (at + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(at);
        if (length === 0) {
          const content = Buffer.concat(parts).toString("latin1");
          if (mode === "too-large") return void socket.end("INSTREAM size limit exceeded. ERROR\0");
          return void socket.end(content.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
        if (at + 4 + length > buffer.length) return;
        parts.push(buffer.subarray(at + 4, at + 4 + length));
        at += 4 + length;
      }
    });
  });
}

beforeAll(async () => {
  server = fakeClamd();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  jobs.CLAMAV_HOST = "127.0.0.1";
  jobs.CLAMAV_PORT = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  jobs.CLAMAV_HOST = undefined;
  server.close();
  await closeQueues();
  await cleanup();
});

const b64 = (value: string) => Buffer.from(value).toString("base64");

async function tusCall(method: "POST" | "PATCH", url: string, ip: string, headers: Record<string, string>, body?: Buffer) {
  const req = new NextRequest(`http://localhost${url}`, { method, headers: { "tus-resumable": "1.0.0", "x-real-ip": ip, ...headers }, body: body ? new Uint8Array(body) : undefined });
  return tus[method](req, { params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }) });
}

/** A visitor sends one file through a new upload-only link of `m`; returns the new node id. */
async function receive(m: FixtureMember, name: string, content: string): Promise<string> {
  const request = (await callRoute<FileRequestDto>(createRequest, { method: "POST", cookie: m.cookie, body: { folderId: "root", title: "Inbox", password: null, expiresInDays: null, maxFiles: null, maxMb: null } })).json.data;
  const ip = randomTestIp();
  const prep = new NextRequest(`http://localhost/api/r/${request.id}/uploads`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify({ files: [{ name, size: Buffer.byteLength(content) }] }) });
  const plan = ((await (await prepare(prep, { params: Promise.resolve({ id: request.id }) })).json()) as { data: RequestUploadPlan }).data;
  const created = await tusCall("POST", plan.endpoint, ip, { "upload-length": String(Buffer.byteLength(content)), "upload-metadata": `batch ${b64(plan.batchId)},index ${b64("0")},filename ${b64(name)}` });
  const url = `${plan.endpoint}/${created.headers.get("location")!.split("/").pop()}`;
  const patched = await tusCall("PATCH", url, ip, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));
  expect(patched.status, await patched.clone().text()).toBe(200);
  return (await prisma.node.findFirstOrThrow({ where: { accountId: m.id, name } })).id;
}

/** A visitor downloads the file through its own (now public) share link. */
async function visitorGet(nodeId: string) {
  const { linkId } = await prisma.node.update({ where: { id: nodeId }, data: { visibility: "PUBLIC" }, select: { linkId: true } });
  const req = new NextRequest(`http://localhost/api/share/${linkId}/files/${nodeId}/download`, { headers: { "x-real-ip": randomTestIp(), "user-agent": "Mozilla/5.0" } });
  return shareDownload(req, { params: Promise.resolve({ linkId, id: nodeId }) });
}

describe("virus scans of upload-link files", () => {
  it("keeps a received file from visitors until clamd finds it clean", async () => {
    const m = await member();
    const id = await receive(m, "report.txt", "quarterly numbers");
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).scanState).toBe("PENDING");
    const early = await visitorGet(id);
    expect([early.status, early.headers.get("retry-after")]).toEqual([503, String(SCAN.pendingRetrySec)]);
    expect(((await early.json()) as { code: string }).code).toBe("SCAN_PENDING");

    expect(await runScan(id)).toBe("clean");
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).scanState).toBe("CLEAN");
    const after = await visitorGet(id);
    expect([after.status, await after.text()]).toEqual([200, "quarterly numbers"]);
    expect((await checkHealth()).components.scanner).toBe("ok");
  });

  it("scans a copy of a file that is still waiting for its scan, and makes no thumbnails before", async () => {
    const m = await member();
    const id = await receive(m, "waiting.jpg", "not really a picture");
    await prisma.node.update({ where: { id }, data: { kind: "IMAGE" } });
    const copied = await callRoute(transfer, { method: "POST", cookie: m.cookie, body: { ids: [id], targetId: "root", mode: "copy" } });
    expect(copied.status).toBe(200);
    const copy = await prisma.node.findFirstOrThrow({ where: { accountId: m.id, name: "waiting (2).jpg" } });
    expect(copy.scanState).toBe("PENDING");
    const queue = new Queue(MEDIA_QUEUE, queueConnection("producer"));
    try {
      // Its own scan job (the original's job never covers the new id), and no media job yet.
      expect((await queue.getJob(`scan-${copy.id}`))?.data).toEqual({ nodeId: copy.id, task: "scan" });
      expect(await queue.getJob(copy.id)).toBeUndefined();
    } finally {
      await queue.close();
    }
    expect(await runScan(copy.id)).toBe("clean");
  });

  it("moves infected files to the trash for good and lists why", async () => {
    const m = await member();
    const id = await receive(m, "invoice.pdf", EICAR);
    expect(await runScan(id)).toBe("infected");
    expect(await prisma.node.count({ where: { id } })).toBe(0);
    const [item] = (await callRoute<DeletedItemDto[]>(trashList, { cookie: m.cookie })).json.data;
    expect(item).toMatchObject({ name: "invoice.pdf", malware: "Eicar-Test-Signature" });
    const refused = await callRoute(restore, { method: "POST", cookie: m.cookie, params: { id: item!.id } });
    expect(refused.status).toBe(403);
    expect(await prisma.node.count({ where: { accountId: m.id, name: "invoice.pdf" } })).toBe(0);
  });

  it("blocks files clamd refuses, scans them again on request, and retries when clamd is away", async () => {
    const m = await member();
    const id = await receive(m, "huge.bin", "pretend this is large");
    mode = "too-large";
    try {
      expect(await runScan(id)).toBe("failed");
    } finally {
      mode = "normal";
    }
    const blocked = await visitorGet(id);
    expect([blocked.status, ((await blocked.json()) as { code: string }).code]).toEqual([403, "FILE_BLOCKED"]);

    expect((await callRoute(rescanRoute, { method: "POST", cookie: m.cookie, params: { id } })).status).toBe(200);
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).scanState).toBe("PENDING");
    // Only files whose scan failed can be scanned again; another account's file is 404.
    expect((await callRoute(rescanRoute, { method: "POST", cookie: m.cookie, params: { id } })).status).toBe(400);
    const other = await member();
    expect((await callRoute(rescanRoute, { method: "POST", cookie: other.cookie, params: { id } })).status).toBe(404);

    // clamd unreachable: the job fails and is tried again; the file stays PENDING.
    const port = jobs.CLAMAV_PORT;
    jobs.CLAMAV_PORT = 1;
    try {
      await expect(runScan(id)).rejects.toThrow();
    } finally {
      jobs.CLAMAV_PORT = port;
    }
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).scanState).toBe("PENDING");
    expect(await runScan(id)).toBe("clean");
  });
});

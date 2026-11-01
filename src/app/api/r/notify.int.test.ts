import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "bullmq";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRequest } from "@/app/api/file-requests/route";
import { POST as prepare } from "@/app/api/r/[id]/uploads/route";
import * as tus from "@/app/api/uploads/tus/[...path]/route";
import type { FileRequestDto, RequestUploadPlan } from "@/contracts/file-requests";
import { layoutOf } from "@/server/storage/layout";
import { initVolume } from "@/server/storage/volume";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../test/file-fixtures";
import { closeNotifyQueue, notifyQueue, queueThrottled } from "@/server/jobs/notify-queue";
import { startNotifyWorker } from "@/server/jobs/notify-worker";
import { watchVolumes } from "@/server/jobs/volume-watch";

interface Delivery {
  path: string;
  authorization: string | undefined;
  body: { event: string; title: string; message: string; data: Record<string, unknown> };
  raw: string;
}

const { prisma, member, cleanup } = fileFixtures();
const deliveries: Delivery[] = [];
let server: Server;
let worker: Worker;
const ENV_KEYS = ["NOTIFY_WEBHOOK_URL", "NOTIFY_WEBHOOK_FORMAT", "NOTIFY_WEBHOOK_TOKEN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      deliveries.push({ path: req.url ?? "", authorization: req.headers.authorization, body: JSON.parse(raw) as Delivery["body"], raw });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Before anything reads the "notify" env group (it is validated once per test file).
  process.env.NOTIFY_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  process.env.NOTIFY_WEBHOOK_FORMAT = "json";
  process.env.NOTIFY_WEBHOOK_TOKEN = "tk_test_secret";
  worker = startNotifyWorker();
});

afterAll(async () => {
  await worker?.close();
  await closeNotifyQueue();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await cleanup();
});

/** Waits until `count` deliveries match. */
async function delivered(match: (delivery: Delivery) => boolean, count = 1, timeoutMs = 10_000): Promise<Delivery[]> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = deliveries.filter(match);
    if (found.length >= count || Date.now() > until) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const b64 = (value: string) => Buffer.from(value).toString("base64");

/** A visitor sends one file of a batch through the link (tus create + one PATCH). */
async function visitorSends(plan: RequestUploadPlan, ip: string, slot: number, name: string, content: string) {
  const tusCall = (method: "POST" | "PATCH", url: string, headers: Record<string, string>, body?: Buffer) =>
    tus[method](new NextRequest(`http://localhost${url}`, { method, headers: { "tus-resumable": "1.0.0", "x-real-ip": ip, ...headers }, body: body ? new Uint8Array(body) : undefined }), {
      params: Promise.resolve({ path: url.replace("/api/uploads/tus/", "").split("/") }),
    });
  const size = String(Buffer.byteLength(content));
  const created = await tusCall("POST", plan.endpoint, { "upload-length": size, "upload-metadata": `batch ${b64(plan.batchId)},index ${b64(String(slot))},filename ${b64(name)}` });
  expect(created.status).toBe(201);
  const url = `${plan.endpoint}/${created.headers.get("location")?.split("/").pop()}`;
  const patched = await tusCall("PATCH", url, { "upload-offset": "0", "content-type": "application/offset+octet-stream" }, Buffer.from(content));
  expect(patched.status).toBe(200);
}

describe("owner notifications", () => {
  it("sends one message for the files a visitor dropped through an upload-only link", async () => {
    const m = await member();
    const owner = await prisma.account.findUniqueOrThrow({ where: { id: m.id }, select: { name: true } });
    const created = await callRoute<FileRequestDto>(createRequest, { method: "POST", cookie: m.cookie, body: { folderId: "root", title: "Trip photos", password: null, expiresInDays: null, maxFiles: null, maxMb: null } });
    const request = created.json.data;
    const ip = randomTestIp();
    const prepared = await prepare(
      new NextRequest(`http://localhost/api/r/${request.id}/uploads`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify({ files: [{ name: "beach.jpg", size: 5 }, { name: "notes.txt", size: 3 }] }) }),
      { params: Promise.resolve({ id: request.id }) },
    );
    const plan = ((await prepared.json()) as { data: RequestUploadPlan }).data;
    await visitorSends(plan, ip, 0, "beach.jpg", "sunny");
    await visitorSends(plan, ip, 1, "notes.txt", "abc");

    // Both arrivals wait in one delayed group job; run it now instead of after the group window.
    const groups = (await notifyQueue().getDelayed()).filter((job) => job.data.group?.requestId === request.id);
    expect(groups).toHaveLength(1);
    await groups[0]!.promote();

    const [message] = await delivered((delivery) => delivery.body.event === "file-request" && delivery.body.message.includes("Trip photos") && delivery.raw.includes(owner.name));
    expect(message).toBeDefined();
    expect(message!).toMatchObject({ path: "/hook", authorization: "Bearer tk_test_secret", body: { title: "Files received", data: { owner: owner.name, request: "Trip photos", count: 2, bytes: 8 } } });
    expect(message!.body.message).toContain("2 files (8 B)");
    expect(message!.body.data.files).toEqual([{ name: "beach.jpg", size: 5 }, { name: "notes.txt", size: 3 }]);
    // Nothing about the visitor, the folder or the link itself.
    expect(message!.raw).not.toContain(ip);
    expect(message!.raw).not.toContain(m.rootId);
    expect(message!.raw).not.toContain(request.url);
  });

  it("sends a repeated alert once per throttle window", async () => {
    const volumeId = randomUUID();
    const event = { kind: "volume-low", volumeId, freeBytes: 1_000, reservePct: 5 } as const;
    expect(await queueThrottled(event, volumeId, 60_000)).toBe(true);
    expect(await queueThrottled(event, volumeId, 60_000)).toBe(false);
    expect(await queueThrottled({ ...event, kind: "volume-readonly" } as const, volumeId, 60_000)).toBe(true);
    const sent = await delivered((delivery) => delivery.raw.includes(volumeId), 2);
    expect(sent.map((delivery) => delivery.body.event).sort()).toEqual(["volume-low", "volume-readonly"]);
    // A little longer: a second volume-low message would have arrived by now.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(deliveries.filter((delivery) => delivery.raw.includes(volumeId))).toHaveLength(2);
  });

  it("alerts once while the volume watch keeps seeing a volume below its reserve, and when it goes offline", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-notify-"));
    const id = randomUUID();
    try {
      await initVolume(root, id);
      // A 100% reserve: no free space above it, so uploads would be refused.
      await prisma.storageVolume.create({ data: { id, mountPath: root, status: "ACTIVE", reservePct: 100 } });
      await watchVolumes();
      await watchVolumes();
      const low = await delivered((delivery) => delivery.body.event === "volume-low" && delivery.raw.includes(id));
      expect(low).toHaveLength(1);
      expect(low[0]!.body.message).toContain("below its 100% reserve");

      const marker = layoutOf(root).marker;
      await rename(marker, `${marker}.away`);
      await watchVolumes();
      const offline = await delivered((delivery) => delivery.body.event === "volume-offline" && delivery.raw.includes(id));
      expect(offline).toHaveLength(1);
      expect(offline[0]!.raw).not.toContain(root);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(deliveries.filter((delivery) => delivery.body.event === "volume-low" && delivery.raw.includes(id))).toHaveLength(1);
    } finally {
      await prisma.storageVolume.deleteMany({ where: { id } });
      await rm(root, { recursive: true, force: true });
    }
  });
});

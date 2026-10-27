import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET as metricsStream } from "@/app/api/admin/server/stream/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { METRICS } from "@/config/policy";
import type { SessionState } from "@/contracts/auth";
import type { ServerSnapshot } from "@/contracts/server-metrics";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { activeCount, markActive } from "@/server/metrics/activity";
import { readDiskHistory, readHistory, recordSample } from "@/server/metrics/history";
import { parseSmart } from "@/server/metrics/services";
import { createAdminAccount } from "@/server/services/auth.service";
import { serverSnapshot } from "@/server/services/server-metrics.service";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../../test/file-fixtures";

const { prisma, member, cleanup } = fileFixtures();
const admins: string[] = [];

afterAll(async () => {
  await prisma.account.deleteMany({ where: { id: { in: admins } } });
  await cleanup();
});

async function adminCookie() {
  const { account, token } = await createAdminAccount();
  admins.push(account.id);
  return (await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() })).cookie!;
}

/** Opens the SSE stream, reads the first event and closes the connection. */
async function firstEvent(cookie: string): Promise<{ status: number; type: string | null; event: string }> {
  const abort = new AbortController();
  const req = new NextRequest("http://localhost/api/admin/server/stream", { headers: { cookie: `${SESSION_COOKIE}=${cookie}` }, signal: abort.signal });
  const res = await metricsStream(req, { params: Promise.resolve({}) });
  let event = "";
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (!event.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      event += decoder.decode(value, { stream: true });
    }
    abort.abort();
    await reader.cancel();
  }
  return { status: res.status, type: res.headers.get("content-type"), event };
}

describe("server metrics", () => {
  it("measures the host, storage and services", async () => {
    await member();
    const snapshot = await serverSnapshot();
    expect(snapshot.cpu.cores).toBeGreaterThan(0);
    expect(snapshot.cpu.percent).toBeGreaterThanOrEqual(0);
    expect(snapshot.memory.totalBytes).toBeGreaterThan(snapshot.memory.usedBytes);
    expect(snapshot.disk?.totalBytes).toBeGreaterThan(0);
    expect(snapshot.live.accounts).toBeGreaterThan(0);
    expect(snapshot.services.map((service) => service.name)).toEqual(["Web server", "Media streaming", "Cleanup job", "Disk health"]);
    expect(snapshot.services[1]!.status).toBe("running");
  });

  it("keeps the bandwidth and disk history oldest first", async () => {
    const base = Date.now();
    await recordSample({ outPerSec: 1_000, disks: [{ name: "sda", readPerSec: 10, writePerSec: 20 }] }, new Date(base));
    await recordSample({ outPerSec: 2_000, disks: [{ name: "sda", readPerSec: 30, writePerSec: 40 }] }, new Date(base + 1));
    expect((await readHistory()).slice(-2).map((sample) => sample.outPerSec)).toEqual([1_000, 2_000]);
    expect((await readDiskHistory()).slice(-2).map((sample) => sample.disks[0]?.readPerSec)).toEqual([10, 30]);
  });

  it("skips the disk history while the counters are priming", async () => {
    const before = (await readDiskHistory()).length;
    await recordSample({ outPerSec: 0, disks: [] }, new Date());
    expect((await readDiskHistory()).length).toBe(before);
  });

  it("counts streams active within the last minute", async () => {
    const now = Date.now();
    const before = await activeCount("stream", now);
    await markActive("stream", `test-${now}`, now);
    expect(await activeCount("stream", now)).toBe(before + 1);
  });

  it("reads SMART health from smartctl JSON", () => {
    const ok = parseSmart(JSON.stringify({ smart_status: { passed: true }, temperature: { current: 38 }, user_capacity: { bytes: 2_000_000_000_000 }, model_name: "Samsung T7" }), "/dev/sda");
    expect(ok).toEqual({ name: "Disk health", detail: "SMART OK · 38°C · 2.0 TB Samsung T7", status: "healthy" });
    expect(parseSmart(JSON.stringify({ smart_status: { passed: false } }), "/dev/sda").status).toBe("failing");
    expect(parseSmart("{}", "/dev/sda")).toMatchObject({ status: "unknown", detail: "SMART data unavailable for /dev/sda" });
    expect(parseSmart("not json", "/dev/sda").status).toBe("unknown");
  });

  it("streams snapshots to admins only", async () => {
    const m = await member();
    expect((await firstEvent(m.cookie)).status).toBe(403);

    const { status, type, event } = await firstEvent(await adminCookie());
    expect(status).toBe(200);
    expect(type).toBe("text/event-stream");
    const snapshot = JSON.parse(event.replace(/^data: /, "").trim()) as ServerSnapshot;
    expect(snapshot.services).toHaveLength(4);
  });

  it("holds at most METRICS.streamMaxPerAccount streams per account", async () => {
    const cookie = await adminCookie();
    const aborts: AbortController[] = [];
    const open = async () => {
      const abort = new AbortController();
      aborts.push(abort);
      const req = new NextRequest("http://localhost/api/admin/server/stream", { headers: { cookie: `${SESSION_COOKIE}=${cookie}` }, signal: abort.signal });
      return metricsStream(req, { params: Promise.resolve({}) });
    };
    const opened = [];
    for (let index = 0; index < METRICS.streamMaxPerAccount; index++) opened.push(await open());
    expect(opened.map((res) => res.status)).toEqual(opened.map(() => 200));
    expect((await open()).status).toBe(429);
    // Closing one frees its place.
    aborts[0]!.abort();
    await opened[0]!.body?.cancel();
    expect((await open()).status).toBe(200);
    for (const abort of aborts) abort.abort();
  });
});

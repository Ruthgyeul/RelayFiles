import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as report } from "@/app/api/csp-report/route";
import { HEADERS } from "@/config/policy";
import { logger } from "@/server/logger";
import { redis } from "@/server/redis";
import { randomTestIp } from "../../../../test/file-fixtures";

afterAll(() => redis().disconnect());

/** The "csp violation" warnings among a logger.warn spy's calls (winston's overloads aside). */
const violations = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter(([message]) => message === "csp violation");

const post = (body: string, type = "application/csp-report", ip = randomTestIp()) =>
  report(new NextRequest("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type, "x-real-ip": ip }, body }), { params: Promise.resolve({}) });

const batchOf = (count: number) => JSON.stringify(Array.from({ length: count }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: `https://img.example/${randomUUID()}` } })));

describe("CSP reports", () => {
  it("logs each distinct violation once, without the query string", async () => {
    const warn = vi.spyOn(logger, "warn");
    const blocked = `https://evil.example/${randomUUID()}.js`;
    const body = JSON.stringify({ "csp-report": { "document-uri": "http://localhost/files?secret=1", "violated-directive": "script-src-elem", "blocked-uri": `${blocked}?q=1` } });
    expect((await post(body)).status).toBe(204);
    expect((await post(body)).status).toBe(204);
    expect(violations(warn)).toEqual([["csp violation", { directive: "script-src-elem", blocked, page: "http://localhost/files" }]]);
  });

  it("reads Reporting API batches and answers 204 to junk or oversized bodies", async () => {
    const warn = vi.spyOn(logger, "warn");
    const batch = JSON.stringify([{ type: "csp-violation", body: { documentURL: "http://localhost/", effectiveDirective: "img-src", blockedURL: `https://img.example/${randomUUID()}` } }]);
    expect((await post(batch, "application/reports+json")).status).toBe(204);
    expect((await post("not json")).status).toBe(204);
    expect((await post("x".repeat(HEADERS.cspReportMaxBytes + 1))).status).toBe(204);
    expect(violations(warn)).toHaveLength(1);
  });

  it("reads at most HEADERS.cspReportMaxPerBody violations of one body", async () => {
    const warn = vi.spyOn(logger, "warn");
    expect((await post(batchOf(30), "application/reports+json")).status).toBe(204);
    expect(violations(warn)).toHaveLength(HEADERS.cspReportMaxPerBody);
  });

  it("drops reports from an address past HEADERS.cspReportsPerAddress, unread", async () => {
    const ip = randomTestIp();
    for (let i = 0; i < HEADERS.cspReportsPerAddress; i += 1) expect((await post("{}", "application/csp-report", ip)).status).toBe(204);
    const warn = vi.spyOn(logger, "warn");
    expect((await post(batchOf(1), "application/reports+json", ip)).status).toBe(204);
    expect(violations(warn)).toHaveLength(0);
    // Another address is still heard.
    expect((await post(batchOf(1), "application/reports+json")).status).toBe(204);
    expect(violations(warn)).toHaveLength(1);
  });

  it("stops logging once every reporter together used the window's log lines", async () => {
    const warn = vi.spyOn(logger, "warn");
    const previous = await redis().get("csp:lines");
    await redis().set("csp:lines", String(HEADERS.cspReportLogLinesPerWindow), "EX", HEADERS.cspReportWindowSec);
    try {
      expect((await post(batchOf(5), "application/reports+json")).status).toBe(204);
      expect(violations(warn)).toHaveLength(0);
    } finally {
      if (previous === null) await redis().del("csp:lines");
      else await redis().set("csp:lines", previous, "EX", HEADERS.cspReportWindowSec);
    }
  });
});

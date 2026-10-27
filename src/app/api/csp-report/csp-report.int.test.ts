import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as report } from "@/app/api/csp-report/route";
import { HEADERS } from "@/config/policy";
import { logger } from "@/server/logger";
import { redis } from "@/server/redis";

afterAll(() => redis().disconnect());

/** The "csp violation" warnings among a logger.warn spy's calls (winston's overloads aside). */
const violations = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter(([message]) => message === "csp violation");

const post = (body: string, type = "application/csp-report") =>
  report(new NextRequest("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type }, body }), { params: Promise.resolve({}) });

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
});

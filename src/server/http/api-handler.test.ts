import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { apiHandler } = await import("./api-handler");
const { ApiError } = await import("./api-error");
const { logger } = await import("../logger");

const call = (handler: ReturnType<typeof apiHandler>, headers: Record<string, string> = {}) =>
  handler(new NextRequest("http://localhost/api/test", { headers }), { params: Promise.resolve({}) });

describe("apiHandler", () => {
  it("wraps plain results in the success envelope and sets a request id", async () => {
    const res = await call(apiHandler(async () => ({ hello: "world" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { hello: "world" } });
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
  });

  it("keeps an incoming request id", async () => {
    const res = await call(apiHandler(async () => null), { "x-request-id": "req-123" });
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("maps ApiError to its status and safe message", async () => {
    const res = await call(
      apiHandler(async () => {
        throw new ApiError("RATE_LIMITED", "Try again in 0:30.", { retryAfter: 30 });
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toEqual({ success: false, error: "Try again in 0:30.", code: "RATE_LIMITED", retryAfter: 30 });
  });

  it("maps ZodError to 400 with field messages", async () => {
    const res = await call(
      apiHandler(async () => {
        z.object({ name: z.string().min(1) }).parse({ name: "" });
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("BAD_REQUEST");
    expect(Object.keys(body.fields)).toEqual(["name"]);
  });

  it("masks unknown errors and logs them", async () => {
    const res = await call(
      apiHandler(async () => {
        throw new Error("SELECT * FROM secret_table at /srv/app/internal.ts:42");
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "Something went wrong.", code: "INTERNAL" });
    expect(JSON.stringify(body)).not.toContain("secret_table");
    expect(logger.error).toHaveBeenCalled();
  });
});

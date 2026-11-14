import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createFolder } from "@/app/api/folders/route";
import { LIVE } from "@/config/policy";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { publishAccountChange } from "@/server/events/account-events";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { GET as events } from "./route";

const { member, cleanup } = fileFixtures();

afterAll(cleanup);

interface OpenStream {
  status: number;
  /** Everything received until `ms` passed or `until` was seen. */
  read: (until: string, ms: number) => Promise<string>;
  close: () => Promise<void>;
}

/** Opens GET /api/events for `m`, as the page's EventSource does. */
async function open(m: FixtureMember): Promise<OpenStream> {
  const abort = new AbortController();
  const req = new NextRequest("http://localhost/api/events", { headers: { cookie: `${SESSION_COOKIE}=${m.cookie}` }, signal: abort.signal });
  const res = await events(req, { params: Promise.resolve({}) });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let received = "";
  return {
    status: res.status,
    read: async (until, ms) => {
      if (!reader) return received;
      const deadline = Date.now() + ms;
      while (!received.includes(until) && Date.now() < deadline) {
        const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))]);
        if (!next || next.done) break;
        received += decoder.decode(next.value, { stream: true });
      }
      return received;
    },
    close: async () => {
      abort.abort();
      await reader?.cancel().catch(() => undefined);
    },
  };
}

describe("live file lists", () => {
  it("tells the account's open pages that something changed, and nobody else", async () => {
    const m = await member();
    const other = await member();
    const mine = await open(m);
    const theirs = await open(other);
    expect(mine.status).toBe(200);
    // The stream opens with a comment, then waits.
    expect(await mine.read(":\n\n", 2_000)).toContain(":\n\n");

    // A change through the app (any signed-in write) reaches the account's stream.
    expect((await callRoute(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: "root", name: "Live" } })).status).toBe(201);
    expect(await mine.read("data: changed", LIVE.coalesceMs + 2_000)).toContain("data: changed");
    expect(await theirs.read("data: changed", LIVE.coalesceMs + 500)).not.toContain("data: changed");
    await Promise.all([mine.close(), theirs.close()]);
  });

  it("merges changes that arrive together into one event", async () => {
    const m = await member();
    const stream = await open(m);
    await stream.read(":\n\n", 2_000);
    for (let index = 0; index < 20; index++) publishAccountChange(m.id);
    const received = await stream.read("never", LIVE.coalesceMs + 1_500);
    expect(received.split("data: changed").length - 1).toBe(1);
    await stream.close();
  });

  it("refuses more open pages than LIVE.maxPerAccount and frees a place when one closes", async () => {
    const m = await member();
    const streams = await Promise.all(Array.from({ length: LIVE.maxPerAccount }, () => open(m)));
    expect(streams.every((stream) => stream.status === 200)).toBe(true);
    const refused = await open(m);
    expect(refused.status).toBe(429);
    await streams[0]!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await open(m);
    expect(again.status).toBe(200);
    await Promise.all([again, ...streams.slice(1)].map((stream) => stream.close()));
  });
});

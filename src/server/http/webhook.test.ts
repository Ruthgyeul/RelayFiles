import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postWebhook, WebhookError } from "./webhook";

type Reply = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let base = "";
let reply: Reply = (_req, res) => res.end();
const received: { path: string; headers: IncomingMessage["headers"]; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      reply(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const request = { headers: { "content-type": "application/json" }, body: '{"event":"x"}' };

async function failure(promise: Promise<void>): Promise<WebhookError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WebhookError);
  return error as WebhookError;
}

describe("postWebhook", () => {
  it("posts the body with the bearer token", async () => {
    reply = (_req, res) => res.writeHead(204).end();
    await postWebhook({ url: `${base}/hook`, token: "tk_secret", timeoutMs: 2_000 }, request);
    expect(received.at(-1)).toMatchObject({ path: "/hook", body: '{"event":"x"}', headers: { authorization: "Bearer tk_secret", "content-type": "application/json" } });
  });

  it("does not follow redirects, even to the same host", async () => {
    reply = (req, res) => (req.url === "/moved" ? res.writeHead(302, { location: `${base}/elsewhere` }).end() : res.end());
    const before = received.length;
    const error = await failure(postWebhook({ url: `${base}/moved`, timeoutMs: 2_000 }, request));
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("redirect");
    expect(received.slice(before).map((entry) => entry.path)).toEqual(["/moved"]);
  });

  it("retries server errors and rate limits, not refusals, and never repeats the response or URL", async () => {
    reply = (_req, res) => res.writeHead(503).end("internal details");
    const busy = await failure(postWebhook({ url: `${base}/bot123:SECRET/sendMessage`, timeoutMs: 2_000 }, request));
    expect(busy).toMatchObject({ retryable: true, message: "webhook answered 503" });
    reply = (_req, res) => res.writeHead(401).end("bad token");
    expect(await failure(postWebhook({ url: `${base}/hook`, timeoutMs: 2_000 }, request))).toMatchObject({ retryable: false, message: "webhook answered 401" });
  });

  it("gives up after the timeout", async () => {
    reply = () => undefined;
    const error = await failure(postWebhook({ url: `${base}/slow`, timeoutMs: 100 }, request));
    expect(error).toMatchObject({ retryable: true, message: "webhook not reached: timed out" });
  });

  it("reports an unreachable receiver without its address", async () => {
    const error = await failure(postWebhook({ url: "http://127.0.0.1:1/hook", timeoutMs: 2_000 }, request));
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("127.0.0.1");
  });
});

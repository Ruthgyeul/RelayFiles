import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getJson } from "./get-json";

// Ports the Fetch standard blocks; fetch() refuses them, getJson must not.
const FETCH_BLOCKED_PORTS = [6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080];
const TIMEOUT_MS = 2_000;
const SHORT_TIMEOUT_MS = 100;

const servers: Server[] = [];

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

/** Serves `handler` on the first free fetch-blocked port (or any port when all are taken). */
async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  for (const port of [...FETCH_BLOCKED_PORTS, 0]) {
    const server = createServer(handler);
    try {
      const bound = await listen(server, port);
      servers.push(server);
      return bound;
    } catch {
      server.close();
    }
  }
  throw new Error("no port available");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }));
});

describe("getJson", () => {
  it("reads JSON from a port fetch() refuses", async () => {
    const port = await serve((_req, res) => res.end(JSON.stringify({ success: true, data: { port: "ok" } })));
    if (FETCH_BLOCKED_PORTS.includes(port)) {
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    }
    await expect(getJson(`http://127.0.0.1:${port}/api/health`, TIMEOUT_MS)).resolves.toEqual({ success: true, data: { port: "ok" } });
  });

  it("parses the body whatever the status code", async () => {
    const port = await serve((_req, res) => {
      res.statusCode = 503;
      res.end(JSON.stringify({ success: true, data: { status: "down" } }));
    });
    await expect(getJson(`http://127.0.0.1:${port}/`, TIMEOUT_MS)).resolves.toEqual({ success: true, data: { status: "down" } });
  });

  it("rejects bodies that are not JSON", async () => {
    const port = await serve((_req, res) => res.end("<html>"));
    await expect(getJson(`http://127.0.0.1:${port}/`, TIMEOUT_MS)).rejects.toThrow();
  });

  it("gives up when the app does not answer in time", async () => {
    const port = await serve(() => undefined);
    await expect(getJson(`http://127.0.0.1:${port}/`, SHORT_TIMEOUT_MS)).rejects.toThrow(/no response/);
  });

  it("rejects when nothing listens", async () => {
    const server = createServer();
    const port = await listen(server, 0);
    await new Promise((resolve) => server.close(resolve));
    await expect(getJson(`http://127.0.0.1:${port}/`, TIMEOUT_MS)).rejects.toThrow();
  });
});

/**
 * WebDAV server (separate from the web app, which cannot answer PROPFIND): npm run dav
 * Serves the account of a personal API token under DAV.prefix (/dav): reads with files:read,
 * changes with files:write.
 * Nginx forwards /dav/ here (DAV_HOST:DAV_PORT); it is never exposed on its own.
 * Stops on SIGINT/SIGTERM after the requests in progress.
 */
process.env.LOG_SERVICE ||= "dav";
await import("./lib/bootstrap.mjs");

const { createServer } = await import("node:http");
const { Readable } = await import("node:stream");
const { getAppEnv } = await import("../src/config/env");
const { davHandler } = await import("../src/server/dav/handler");
const { logger } = await import("../src/server/logger");
const { db } = await import("../src/server/db/client");
const { closeRedis } = await import("../src/server/redis");

/** Request methods without a body (the rest are streamed through). */
const NO_BODY = new Set(["GET", "HEAD", "OPTIONS", "PROPFIND"]);

const server = createServer((incoming, outgoing) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const method = incoming.method ?? "GET";
  // PROPFIND bodies (which properties to return) are not read: every answer has the same set.
  if (method === "PROPFIND") incoming.resume();
  const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
    method,
    headers,
    body: NO_BODY.has(method) ? undefined : (Readable.toWeb(incoming) as ReadableStream),
    duplex: "half",
  } as RequestInit);
  davHandler(request)
    .then((response) => {
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body || method === "HEAD") outgoing.end();
      else Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(outgoing);
    })
    .catch((error: unknown) => {
      logger.error("dav response failed", { error });
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    });
});

const { DAV_HOST, DAV_PORT } = getAppEnv();
server.listen(DAV_PORT, DAV_HOST, () => logger.info("dav started", { host: DAV_HOST, port: DAV_PORT }));

function stop(signal: string) {
  logger.info("dav stopping", { signal });
  server.close(() => {
    void db()
      .$disconnect()
      .finally(() => {
        closeRedis();
        process.exit(0);
      });
  });
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

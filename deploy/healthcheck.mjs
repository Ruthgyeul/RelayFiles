/**
 * Docker HEALTHCHECK of the app image (Dockerfile). Runs in exec form, so no shell sits
 * between Docker and this process, and it always exits on its own before Docker's
 * `--timeout`: Docker never has to kill it, and nothing is left for the container's PID 1.
 */
import { request } from "node:http";

/** Below the HEALTHCHECK --timeout in the Dockerfile (5 s), including Node's start-up. */
const REQUEST_TIMEOUT_MS = 3_000;
const HTTP_ERROR = 400;

const req = request(
  { host: "127.0.0.1", port: process.env.PORT || 3000, path: "/api/health", method: "HEAD", timeout: REQUEST_TIMEOUT_MS },
  (res) => {
    res.resume();
    process.exit(res.statusCode !== undefined && res.statusCode < HTTP_ERROR ? 0 : 1);
  },
);
req.on("timeout", () => req.destroy(new Error("timeout")));
req.on("error", () => process.exit(1));
req.end();

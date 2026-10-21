import "server-only";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";

/**
 * GETs a URL with Node's http client and parses the body as JSON (any status code).
 *
 * The worker uses this instead of `fetch` to reach the app: `fetch` refuses the ports the
 * Fetch standard lists as unsafe (6000 for X11, 6665-6669, 10080, ...), so an app listening
 * on such a port behind Nginx would always look unreachable.
 */
export function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const target = new URL(url);
  const get = target.protocol === "https:" ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    // agent: false opens a fresh connection each time, so a probe never reuses a socket the
    // app closed while restarting.
    const req = get(target, { agent: false, headers: { accept: "application/json" }, timeout: timeoutMs }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`no response within ${timeoutMs} ms`)));
    req.on("error", reject);
  });
}

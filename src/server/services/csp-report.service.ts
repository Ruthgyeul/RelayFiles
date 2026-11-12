import "server-only";
import { createHash } from "node:crypto";
import { HEADERS } from "@/config/policy";
import { parseCspReports } from "@/domain/security-headers";
import type { ClientInfo } from "../auth/client-info";
import { logger } from "../logger";
import { countInWindow, redis } from "../redis";

const DEDUPE_KEY_HEX_LENGTH = 16;
/** Violation log lines written in the current window by every app process together. */
const LOG_LINES_KEY = "csp:lines";

/** Reads at most `maxBytes` of a request body; null when it is longer (the rest is not read). */
async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Logs the CSP violations browsers report (CSP_MODE=report-only shows what enforcing would
 * block). Reports are anonymous and unauthenticated, so the endpoint is bounded on every side:
 * bodies per address and window (the rest is dropped unread), violations per body, and log
 * lines per window from everyone together (each distinct violation once per
 * HEADERS.cspReportDedupeSec). Nothing about the visitor is kept.
 */
export async function recordCspReports(body: ReadableStream<Uint8Array> | null, client: Pick<ClientInfo, "ipKey">): Promise<void> {
  if ((await countInWindow(`csp:from:${client.ipKey}`, HEADERS.cspReportWindowSec)) > HEADERS.cspReportsPerAddress) {
    await body?.cancel();
    return;
  }
  const raw = await readCapped(body, HEADERS.cspReportMaxBytes);
  if (!raw) return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  for (const violation of parseCspReports(payload, HEADERS.cspReportMaxPerBody)) {
    // Checked before a dedupe key is made, so a flood creates no more keys than log lines.
    if (Number((await redis().get(LOG_LINES_KEY)) ?? 0) >= HEADERS.cspReportLogLinesPerWindow) return;
    const digest = createHash("sha256").update(`${violation.directive}\n${violation.blocked}`).digest("hex").slice(0, DEDUPE_KEY_HEX_LENGTH);
    const fresh = await redis().set(`csp:${digest}`, "1", "EX", HEADERS.cspReportDedupeSec, "NX");
    if (!fresh) continue;
    await countInWindow(LOG_LINES_KEY, HEADERS.cspReportWindowSec);
    logger.warn("csp violation", { ...violation });
  }
}

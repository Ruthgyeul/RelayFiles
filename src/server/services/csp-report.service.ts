import "server-only";
import { createHash } from "node:crypto";
import { HEADERS } from "@/config/policy";
import { parseCspReports } from "@/domain/security-headers";
import { logger } from "../logger";
import { redis } from "../redis";

const DEDUPE_KEY_HEX_LENGTH = 16;

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
 * block). Reports are anonymous and unauthenticated, so each distinct violation is logged once
 * per HEADERS.cspReportDedupeSec and nothing about the visitor is kept.
 */
export async function recordCspReports(body: ReadableStream<Uint8Array> | null): Promise<void> {
  const raw = await readCapped(body, HEADERS.cspReportMaxBytes);
  if (!raw) return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  for (const violation of parseCspReports(payload)) {
    const digest = createHash("sha256").update(`${violation.directive}\n${violation.blocked}`).digest("hex").slice(0, DEDUPE_KEY_HEX_LENGTH);
    const fresh = await redis().set(`csp:${digest}`, "1", "EX", HEADERS.cspReportDedupeSec, "NX");
    if (fresh) logger.warn("csp violation", { ...violation });
  }
}

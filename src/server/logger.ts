import "server-only";
import { mkdirSync } from "node:fs";
import winston from "winston";
import { getAppEnv, getEnv, logLevelOf } from "@/config/env";

/** Keys whose values must never reach the logs (CLAUDE.md: no tokens, passwords or real IPs). */
const SENSITIVE_KEY = /token|password|secret|authorization|cookie|^ip$|ipaddress|x-forwarded-for|cf-connecting-ip/i;
const REDACTED = "[redacted]";

/** Returns a copy of `value` with sensitive fields replaced. Exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
  );
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === "level" || key === "message") continue;
    info[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(info[key]);
  }
  return info;
});

function createLogger(): winston.Logger {
  const app = getAppEnv();
  const observability = getEnv("observability");
  const production = app.NODE_ENV === "production";
  const transports: winston.transport[] = [new winston.transports.Console()];

  if (production) {
    try {
      mkdirSync(observability.LOG_DIR, { recursive: true });
      transports.push(
        new winston.transports.File({ filename: `${observability.LOG_DIR}/error.log`, level: "error" }),
        new winston.transports.File({ filename: `${observability.LOG_DIR}/combined.log` }),
      );
    } catch {
      // The log directory is not writable (e.g. read-only container): keep console output only.
    }
  }

  return winston.createLogger({
    level: logLevelOf(app.NODE_ENV, observability),
    format: winston.format.combine(redactFormat(), winston.format.timestamp(), winston.format.errors({ stack: !production }), winston.format.json()),
    defaultMeta: { service: "relayfiles" },
    transports,
  });
}

const globalForLogger = globalThis as unknown as { relayLogger?: winston.Logger };

/** Process-wide structured logger: `{ level, message, timestamp, ...meta }`. */
export const logger: winston.Logger = globalForLogger.relayLogger ?? createLogger();
if (process.env.NODE_ENV !== "production") globalForLogger.relayLogger = logger;

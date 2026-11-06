/** Shared field schemas of the environment groups (src/config/env.ts). */
import { z } from "zod";

export type Source = Record<string, string | undefined>;

export const port = z.coerce.number().int().min(1).max(65_535);
export const positiveInt = z.coerce.number().int().positive();
export const bool = z.stringbool();
/** A memory size Docker and systemd both read: "512M", "2G". */
export const memorySize = z.string().regex(/^\d+[KMG]$/);
export const cpus = z.coerce.number().positive().max(256);
const CIDR = /^(\d{1,3})(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/;
export const cidrList = z
  .string()
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(CIDR, "must be a comma-separated list of IPv4 CIDRs, e.g. 192.168.0.0/24")));
export const secret = (minLength: number) => z.string().min(minLength, `must be at least ${minLength} characters (run npm run env:secrets)`);
/** Decoded byte length of a base64 string, or -1 when it is not valid base64. */
function base64ByteLength(value: string): number {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
}
export const base64Key32 = z
  .string()
  .refine((value) => base64ByteLength(value) === 32, "must be 32 random bytes encoded as base64 (run npm run env:secrets)");
export const secondsList = z
  .string()
  .transform((value) => value.split(",").map((item) => Number(item.trim())))
  .pipe(z.array(z.number().int().positive()).min(1));

/** IPv4 ranges a LAN service answers on: loopback, RFC 1918, link-local, CGNAT (Tailscale). */
const LAN_IPV4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
/** Names only a LAN resolves: one label (a compose service such as `ntfy`) or a local suffix. */
const LAN_NAME = /^([a-z0-9-]+|.+\.(local|lan|internal|home\.arpa))$/i;

/** True for a host that cannot be reached from the internet, so plain http to it stays on the LAN. */
export function isLanHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return LAN_IPV4.test(host);
  return LAN_NAME.test(host);
}

/**
 * Where owner notifications are posted: https anywhere, or plain http to a LAN host (a self-hosted
 * ntfy next to the server). No user:password in the URL (fetch refuses it; use NOTIFY_WEBHOOK_TOKEN).
 */
export const webhookUrl = z.url().superRefine((value, ctx) => {
  // z.url() has reported a value that does not parse; the refinement still runs.
  if (!URL.canParse(value)) return;
  const url = new URL(value);
  if (url.username || url.password) ctx.addIssue({ code: "custom", message: "must not contain a user name or password (use NOTIFY_WEBHOOK_TOKEN)" });
  if (url.protocol === "https:") return;
  if (url.protocol !== "http:" || !isLanHost(url.hostname)) {
    ctx.addIssue({ code: "custom", message: "must be https, or http to a LAN host (127.x, 10.x, 172.16-31.x, 192.168.x, 100.64-127.x, *.local, *.lan)" });
  }
});

export const NOTIFY_FORMATS = ["json", "ntfy", "discord", "telegram"] as const;

import "server-only";
import { createHmac } from "node:crypto";
import { parseUserAgent } from "@/domain/device";
import { clientIp, isPrivateIp, maskIp } from "@/domain/network";
import { getEnv } from "@/config/env";

/** What the server records about the device making a request. The raw IP never leaves this module. */
export interface ClientInfo {
  os: string;
  browser: string;
  ipMasked: string;
  /** Keyed hash of the IP for rate limits; not reversible without the server key. */
  ipKey: string;
  country: string | null;
  city: string | null;
}

/** Cloudflare placeholders for unknown or Tor traffic. */
const UNKNOWN_COUNTRIES = new Set(["XX", "T1"]);
const IP_KEY_HEX_LENGTH = 32;

export function ipKeyOf(ip: string): string {
  return createHmac("sha256", getEnv("secrets").TOKEN_HMAC_KEY)
    .update(`ip:${ip || "unknown"}`)
    .digest("hex")
    .slice(0, IP_KEY_HEX_LENGTH);
}

function headerText(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  if (!value) return null;
  try {
    // Cloudflare sends city names percent-encoded when they contain non-ASCII characters.
    return decodeURIComponent(value).slice(0, 80);
  } catch {
    return value.slice(0, 80);
  }
}

export function clientInfo(headers: Headers): ClientInfo {
  const ip = clientIp(headers);
  const { os, browser } = parseUserAgent(headers.get("user-agent") ?? "");
  const local = ip === "" || isPrivateIp(ip);
  const country = local ? null : headerText(headers, "cf-ipcountry");
  return {
    os,
    browser,
    ipMasked: ip ? maskIp(ip) : maskIp("unknown"),
    ipKey: ipKeyOf(ip),
    country: country && !UNKNOWN_COUNTRIES.has(country.toUpperCase()) ? country.toUpperCase() : null,
    city: local ? null : headerText(headers, "cf-ipcity"),
  };
}

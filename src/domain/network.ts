/**
 * IP address helpers. Real IP addresses are never stored or logged, only masked forms
 * (docs/security.md "인증"); these functions run on the address read from the proxy headers.
 */

const MASK = "•••";

/** "211.36.12.7" → "211.36.•••.•••"; IPv6 keeps the first two groups. */
export function maskIp(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${MASK}.${MASK}`;
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    return `${groups.slice(0, 2).join(":")}:${MASK}`;
  }
  return MASK;
}

/** True for loopback and RFC 1918 / unique-local addresses (shown as "Local network"). */
export function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  const v4 = /^172\.(\d{1,3})\./.exec(ip);
  if (v4 && Number(v4[1]) >= 16 && Number(v4[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(ip);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** True when an IPv4 address is inside one of the CIDR ranges (e.g. "192.168.0.0/24"). IPv6 never matches. */
export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const address = ipv4ToInt(ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip);
  if (address === null) return false;
  return cidrs.some((cidr) => {
    const [base = "", bitsText = "32"] = cidr.split("/");
    const network = ipv4ToInt(base);
    const bits = Number(bitsText);
    if (network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const size = 2 ** (32 - bits);
    return Math.floor(address / size) === Math.floor(network / size);
  });
}

const IPV6_GROUPS = 8;
/** Groups in the /64 prefix most providers hand to one customer. */
const IPV6_SUBJECT_GROUPS = 4;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** The 8 groups of an IPv6 address (`::` expanded, zone id and an IPv4 tail handled), or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.replace(/%.*$/, "").toLowerCase();
  const v4Tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4Tail) {
    const value = ipv4ToInt(v4Tail[1]!);
    if (value === null) return null;
    text = `${text.slice(0, -v4Tail[1]!.length)}${Math.floor(value / 65_536).toString(16)}:${(value % 65_536).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * What per-address limits (sign-in lockouts, sign-ups, password guesses) are keyed on. An
 * IPv6 user usually gets a whole /64 and can pick any address in it, so IPv6 addresses count
 * as their /64; IPv4 (also written as an IPv4-mapped IPv6 address) counts as itself.
 */
export function rateLimitSubject(ip: string): string {
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  return `${groups.slice(0, IPV6_SUBJECT_GROUPS).map((group) => group.toString(16)).join(":")}::/64`;
}

/** Longest address accepted from a header (IPv6 with zone id fits easily). */
const MAX_IP_LENGTH = 64;

/**
 * Client address set by the reverse proxy: Cloudflare's CF-Connecting-IP, then Nginx's
 * X-Real-IP. The app port must only be reachable through Nginx so these cannot be forged
 * (see .env.example). Empty when the request did not pass through a proxy (local dev).
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const raw = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "";
  return raw.trim().slice(0, MAX_IP_LENGTH);
}

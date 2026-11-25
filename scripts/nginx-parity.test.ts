import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The container Nginx (deploy/nginx/templates/relayfiles-site.inc.template) and the host Nginx
 * of the systemd setup (deploy/nginx/host/relayfiles.conf.template) serve the same locations.
 * They cannot share one include (different upstream variables, maintenance paths, X-Accel only
 * in the container), so this keeps the shared locations' directives in step instead.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Names that differ only by setup, written the same way before comparing. */
const SAME_THING: [RegExp, string][] = [
  [/\$relay_client_ip|\$remote_addr/g, "$CLIENT_IP"],
  [/\$relayfiles_proto|\$relay_proto/g, "$PROTO"],
  [/\b(relayfiles|relay)_(auth|uploads|api|tus|dav)\b/g, "zone_$2"],
  [/@relayfiles_rate_limited|@relay_rate_limited/g, "@rate_limited"],
  [/\/etc\/nginx\/maintenance\/on|\$\{APP_DIR\}\/deploy\/maintenance\/on/g, "MAINTENANCE_FLAG"],
];

/** Directives allowed to differ, with why. */
const ALLOWED: Record<string, string> = {
  // Where the static error pages are: in the image, or in the checkout.
  "alias /usr/share/nginx/error/": "container error pages",
  "alias ${APP_DIR}/deploy/error-pages/": "host error pages",
};

/** Each `location <match> { … }` of a template: its directives, comments dropped, one per line. */
function locations(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let normalized = text.replace(/#[^\n]*/g, "");
  for (const [pattern, name] of SAME_THING) normalized = normalized.replace(pattern, name);
  for (const match of normalized.matchAll(/location\s+([^{]+?)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const directives = match[2]!
      .split(";")
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((part) => part !== "" && !(part in ALLOWED));
    found.set(match[1]!.trim(), directives);
  }
  return found;
}

const container = locations(read("deploy/nginx/templates/relayfiles-site.inc.template"));
const host = locations(read("deploy/nginx/host/relayfiles.conf.template"));
const SHARED = ["@rate_limited", "^~ /_errors/", "^~ /dav/", "^~ /api/uploads/tus", "/"];

describe("nginx templates", () => {
  it("both serve the shared locations", () => {
    for (const name of SHARED) {
      expect(container.has(name), `container ${name}`).toBe(true);
      expect(host.has(name), `host ${name}`).toBe(true);
    }
  });

  it.each(SHARED)("%s has the same directives in both", (name) => {
    expect(host.get(name)).toEqual(container.get(name));
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { envDefaults } from "../src/config/env";
import { HOST_ONLY_ENV } from "./lib/host-only-env.mjs";

/**
 * The shell installers and compose run without the app's code, so they repeat the defaults of
 * src/config/env/*.ts. These checks keep every repeated default equal to the schema's.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Defaults the deployments set apart from the schema's, which are for a development checkout. */
const DEPLOYED_DEFAULTS: Record<string, string> = {
  // The external SSD (docs/deploy-ubuntu.md); the schema's default is the checkout's .data folder.
  STORAGE_ROOT: "/mnt/relayfilesDB",
};
const defaults: Record<string, unknown> = { ...envDefaults(), ...DEPLOYED_DEFAULTS };
const asText = (value: unknown) => (Array.isArray(value) ? value.join(",") : String(value));

/** `KEY` → every default a file gives it, from the patterns that file uses. */
function defaultsIn(text: string, pattern: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const match of text.matchAll(pattern)) found.set(match[1]!, [...(found.get(match[1]!) ?? []), match[2]!]);
  return found;
}

/** The repeated defaults that differ from the schema (keys the schema has no default for are skipped). */
function mismatches(found: Map<string, string[]>): string[] {
  return [...found].flatMap(([key, values]) => (key in defaults ? values.filter((value) => value !== asText(defaults[key])).map((value) => `${key}: ${value} (schema ${asText(defaults[key])})`) : []));
}

describe("deployment defaults", () => {
  it("systemd install.sh uses the schema's defaults (env_value KEY default)", () => {
    const found = defaultsIn(read("deploy/scripts/systemd/install.sh"), /env_value ([A-Z0-9_]+) ([^\s)"]+)/g);
    expect(found.size).toBeGreaterThan(10);
    expect(mismatches(found)).toEqual([]);
  });

  it("k3s deploy.sh uses the schema's defaults (KEY:default pairs and env_value)", () => {
    const text = read("deploy/scripts/k3s/deploy.sh");
    const pairs = defaultsIn(text, /\b([A-Z][A-Z0-9_]+):([^\s;"$]+)/g);
    const calls = defaultsIn(text, /env_value "?([A-Z0-9_]+)"? ([^\s)"$]+)/g);
    expect(pairs.size).toBeGreaterThan(10);
    expect(mismatches(pairs)).toEqual([]);
    expect(mismatches(calls)).toEqual([]);
  });

  it("docker compose uses the schema's defaults (${KEY:-default})", () => {
    const found = defaultsIn(read("deploy/docker-compose.yml"), /\$\{([A-Z0-9_]+):-([^}]*)\}/g);
    expect(found.size).toBeGreaterThan(10);
    expect(mismatches(found)).toEqual([]);
  });
});

describe("host-only settings", () => {
  it("are kept from the app in compose and k3s, as the app drops them itself (scripts/lib/host-only-env.mjs)", () => {
    const compose = read("deploy/docker-compose.yml");
    for (const key of HOST_ONLY_ENV) expect(compose, key).toMatch(new RegExp(`\\b${key}: ""`));
    // k3s: deploy.sh leaves them out of the env file the pods get.
    const excluded = /grep -vE '\^\(([A-Z_|]+)\)='/.exec(read("deploy/scripts/k3s/deploy.sh"))?.[1]?.split("|");
    expect(new Set(excluded)).toEqual(new Set(HOST_ONLY_ENV));
  });
});

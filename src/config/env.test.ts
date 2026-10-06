import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkAllEnv, databaseUrlOf, ENV_KEYS, EnvError, logLevelOf, parseEnvGroup, redisUrlOf } from "./env";

const SECRETS = {
  TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  TOKEN_HMAC_KEY: "h".repeat(32),
  COOKIE_SECRET: "c".repeat(32),
};

function exampleKeys(): string[] {
  return readFileSync(".env.example", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")));
}

describe(".env.example", () => {
  it("lists exactly the keys defined in env.ts (no missing or stale keys)", () => {
    expect([...exampleKeys()].sort()).toEqual([...ENV_KEYS].sort());
  });
});

describe("parseEnvGroup", () => {
  it("applies app defaults for an empty environment", () => {
    const app = parseEnvGroup("app", {});
    expect(app).toMatchObject({ NODE_ENV: "development", APP_PORT: 3000, DEFAULT_THEME: "sky", ENABLE_UI_CATALOG: false, ADMIN_ALLOWED_CIDRS: [] });
  });

  it("treats empty strings as unset so defaults apply", () => {
    expect(parseEnvGroup("app", { APP_PORT: "", ADMIN_ALLOWED_CIDRS: "" })).toMatchObject({ APP_PORT: 3000, ADMIN_ALLOWED_CIDRS: [] });
  });

  it("parses booleans, ports and CIDR lists", () => {
    const app = parseEnvGroup("app", { ENABLE_UI_CATALOG: "true", APP_PORT: "8080", ADMIN_ALLOWED_CIDRS: "192.168.0.0/24, 10.0.0.0/8" });
    expect(app.ENABLE_UI_CATALOG).toBe(true);
    expect(app.APP_PORT).toBe(8080);
    expect(app.ADMIN_ALLOWED_CIDRS).toEqual(["192.168.0.0/24", "10.0.0.0/8"]);
  });

  it("accepts every theme key from the design and rejects unknown ones", () => {
    for (const theme of ["blue", "lime", "coral", "amber", "teal", "mono", "plum", "crimson", "forest", "sky"]) {
      expect(parseEnvGroup("app", { DEFAULT_THEME: theme }).DEFAULT_THEME).toBe(theme);
    }
    expect(() => parseEnvGroup("app", { DEFAULT_THEME: "neon" })).toThrow(EnvError);
  });

  it("requires database and redis passwords", () => {
    expect(() => parseEnvGroup("database", {})).toThrow(/POSTGRES_PASSWORD/);
    expect(() => parseEnvGroup("redis", {})).toThrow(/REDIS_PASSWORD/);
  });

  it("validates secret formats", () => {
    expect(parseEnvGroup("secrets", SECRETS).TOKEN_ENC_KEY).toBe(SECRETS.TOKEN_ENC_KEY);
    expect(() => parseEnvGroup("secrets", { ...SECRETS, TOKEN_ENC_KEY: "short" })).toThrow(/TOKEN_ENC_KEY/);
    expect(() => parseEnvGroup("secrets", { ...SECRETS, COOKIE_SECRET: "x" })).toThrow(/COOKIE_SECRET/);
  });

  it("parses the lockout ladder", () => {
    expect(parseEnvGroup("policy", {}).LOGIN_LOCK_SECONDS).toEqual([30, 120, 600]);
    expect(parseEnvGroup("policy", { LOGIN_LOCK_SECONDS: "10, 20" }).LOGIN_LOCK_SECONDS).toEqual([10, 20]);
  });
});

describe("checkAllEnv", () => {
  it("reports every missing required value with its group", () => {
    const issues = checkAllEnv({});
    expect(issues.some((i) => i.startsWith("[database]") && i.includes("POSTGRES_PASSWORD"))).toBe(true);
    expect(issues.some((i) => i.startsWith("[secrets]") && i.includes("TOKEN_ENC_KEY"))).toBe(true);
  });

  it("passes for a complete environment", () => {
    expect(checkAllEnv({ POSTGRES_PASSWORD: "p".repeat(16), REDIS_PASSWORD: "r".repeat(16), ...SECRETS })).toEqual([]);
  });
});

describe("connection URLs", () => {
  it("builds DATABASE_URL and REDIS_URL from parts with escaping", () => {
    const db = parseEnvGroup("database", { POSTGRES_PASSWORD: "p@ss/word#1234567" });
    expect(databaseUrlOf(db)).toBe("postgresql://relayfiles:p%40ss%2Fword%231234567@localhost:5432/relayfiles?schema=public");
    const redis = parseEnvGroup("redis", { REDIS_PASSWORD: "r".repeat(16) });
    expect(redisUrlOf(redis)).toBe(`redis://:${"r".repeat(16)}@localhost:6379/0`);
  });

  it("prefers explicit URLs", () => {
    const db = parseEnvGroup("database", { POSTGRES_PASSWORD: "p".repeat(16), DATABASE_URL: "postgresql://x@h/db" });
    expect(databaseUrlOf(db)).toBe("postgresql://x@h/db");
  });
});

describe("logLevelOf", () => {
  it("defaults to warn in production and debug in development, and prefers LOG_LEVEL", () => {
    expect(logLevelOf("production", parseEnvGroup("observability", {}))).toBe("warn");
    expect(logLevelOf("development", parseEnvGroup("observability", {}))).toBe("debug");
    expect(logLevelOf("production", parseEnvGroup("observability", { LOG_LEVEL: "info" }))).toBe("info");
  });
});

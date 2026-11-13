import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkAllEnv, databaseUrlOf, ENV_KEYS, EnvError, isLanHost, logLevelOf, parseEnvGroup, redisUrlOf } from "./env";

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
    // A previous key equal to the current one is a rotation that did not happen.
    expect(() => parseEnvGroup("secrets", { ...SECRETS, COOKIE_SECRET_PREVIOUS: SECRETS.COOKIE_SECRET })).toThrow(/COOKIE_SECRET_PREVIOUS: must differ from COOKIE_SECRET/);
    expect(() => parseEnvGroup("secrets", { ...SECRETS, TOKEN_ENC_KEY_PREVIOUS: SECRETS.TOKEN_ENC_KEY })).toThrow(/TOKEN_ENC_KEY_PREVIOUS/);
    expect(parseEnvGroup("secrets", { ...SECRETS, TOKEN_HMAC_KEY_PREVIOUS: "p".repeat(32) }).TOKEN_HMAC_KEY_PREVIOUS).toBe("p".repeat(32));
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

describe("offsite backup settings", () => {
  it("is off without a repository and keeps the default retention", () => {
    expect(parseEnvGroup("offsite", {})).toEqual({ OFFSITE_KEEP_DAILY: 7, OFFSITE_KEEP_WEEKLY: 4, OFFSITE_KEEP_MONTHLY: 6, OFFSITE_CHECK_PERCENT: 5 });
  });

  it("needs a password with a repository, a known backend and absolute extra paths", () => {
    const repo = "s3:https://acc.r2.cloudflarestorage.com/bucket/relayfiles";
    expect(() => parseEnvGroup("offsite", { RESTIC_REPOSITORY: repo })).toThrow(EnvError);
    expect(parseEnvGroup("offsite", { RESTIC_REPOSITORY: repo, RESTIC_PASSWORD: "p".repeat(16) }).RESTIC_REPOSITORY).toBe(repo);
    expect(() => parseEnvGroup("offsite", { RESTIC_REPOSITORY: "/local/dir", RESTIC_PASSWORD: "p".repeat(16) })).toThrow(EnvError);
    expect(() => parseEnvGroup("offsite", { RESTIC_PASSWORD: "short" })).toThrow(EnvError);
    expect(parseEnvGroup("offsite", { OFFSITE_EXTRA_PATHS: "/mnt/a/users /mnt/b/users" }).OFFSITE_EXTRA_PATHS).toBe("/mnt/a/users /mnt/b/users");
    expect(() => parseEnvGroup("offsite", { OFFSITE_EXTRA_PATHS: "relative/users" })).toThrow(EnvError);
  });
});

describe("notification settings", () => {
  it("is off without a URL and posts generic JSON by default", () => {
    expect(parseEnvGroup("notify", {})).toEqual({ NOTIFY_WEBHOOK_FORMAT: "json" });
  });

  it("accepts https anywhere and plain http only to a LAN host", () => {
    for (const url of ["https://ntfy.sh/relay-topic", "http://192.168.0.10:8080/relay", "http://127.0.0.1:9000/hook", "http://ntfy/relay", "http://nas.local/hook", "http://100.101.1.2/hook"]) {
      expect(parseEnvGroup("notify", { NOTIFY_WEBHOOK_URL: url }).NOTIFY_WEBHOOK_URL).toBe(url);
    }
    for (const url of ["http://ntfy.sh/relay-topic", "http://8.8.8.8/hook", "ftp://192.168.0.10/x", "https://user:pass@ntfy.sh/topic", "not a url"]) {
      expect(() => parseEnvGroup("notify", { NOTIFY_WEBHOOK_URL: url }), url).toThrow(EnvError);
    }
  });

  it("needs a chat id for Telegram", () => {
    const url = "https://api.telegram.org/bot123:abc/sendMessage";
    expect(() => parseEnvGroup("notify", { NOTIFY_WEBHOOK_URL: url, NOTIFY_WEBHOOK_FORMAT: "telegram" })).toThrow(/NOTIFY_TELEGRAM_CHAT_ID/);
    expect(parseEnvGroup("notify", { NOTIFY_WEBHOOK_URL: url, NOTIFY_WEBHOOK_FORMAT: "telegram", NOTIFY_TELEGRAM_CHAT_ID: "-1001234" }).NOTIFY_TELEGRAM_CHAT_ID).toBe("-1001234");
    expect(() => parseEnvGroup("notify", { NOTIFY_WEBHOOK_FORMAT: "slack" })).toThrow(EnvError);
  });
});

describe("worker roles", () => {
  it("runs every role by default", () => {
    expect(parseEnvGroup("jobs", {}).WORKER_ROLES).toEqual(["media", "maintenance", "notify"]);
  });

  it("takes a subset in any order, once each, and rejects unknown or empty lists", () => {
    expect(parseEnvGroup("jobs", { WORKER_ROLES: "media" }).WORKER_ROLES).toEqual(["media"]);
    expect(parseEnvGroup("jobs", { WORKER_ROLES: " notify, maintenance ,notify" }).WORKER_ROLES).toEqual(["notify", "maintenance"]);
    expect(() => parseEnvGroup("jobs", { WORKER_ROLES: "media,thumbnails" })).toThrow(EnvError);
    expect(() => parseEnvGroup("jobs", { WORKER_ROLES: " , " })).toThrow(/at least one of/);
  });
});

describe("k3s media workers", () => {
  it("are off by default and keep media on the storage node", () => {
    const env = parseEnvGroup("deploy", {});
    expect(env.K3S_MEDIA_REPLICAS).toBe(0);
    expect(env.K3S_STORAGE_NODE_MEDIA).toBe(true);
    expect(env.K3S_MEDIA_CONCURRENCY).toBe(1);
  });

  it("need the NFS server they mount", () => {
    expect(() => parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "2" })).toThrow(/K3S_MEDIA_NFS_SERVER/);
    expect(parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "2", K3S_MEDIA_NFS_SERVER: "192.168.0.100" }).K3S_MEDIA_NFS_SERVER).toBe("192.168.0.100");
    expect(parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "1", K3S_MEDIA_NFS_SERVER: "n95.lan" }).K3S_MEDIA_NFS_SERVER).toBe("n95.lan");
    expect(() => parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "1", K3S_MEDIA_NFS_SERVER: "nfs://n95" })).toThrow(EnvError);
    expect(() => parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "1", K3S_MEDIA_NFS_SERVER: "n95", K3S_MEDIA_NFS_PATH: "relative" })).toThrow(EnvError);
    expect(() => parseEnvGroup("deploy", { K3S_MEDIA_REPLICAS: "9", K3S_MEDIA_NFS_SERVER: "n95" })).toThrow(EnvError);
  });

  it("must exist before the storage node stops making thumbnails", () => {
    expect(() => parseEnvGroup("deploy", { K3S_STORAGE_NODE_MEDIA: "false" })).toThrow(/K3S_STORAGE_NODE_MEDIA/);
    expect(parseEnvGroup("deploy", { K3S_STORAGE_NODE_MEDIA: "false", K3S_MEDIA_REPLICAS: "1", K3S_MEDIA_NFS_SERVER: "n95" }).K3S_STORAGE_NODE_MEDIA).toBe(false);
  });
});

describe("isLanHost", () => {
  it("knows private, loopback, CGNAT and local names", () => {
    const lan = ["10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "100.127.0.1", "localhost", "ntfy", "nas.lan", "box.home.arpa", "[::1]", "fd12:3456::1"];
    expect(lan.filter((host) => !isLanHost(host))).toEqual([]);
    const internet = ["8.8.8.8", "172.32.0.1", "100.128.0.1", "example.com", "ntfy.sh", "2001:db8::1"];
    expect(internet.filter(isLanHost)).toEqual([]);
  });
});

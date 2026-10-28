import { z } from "zod";
import { ACCOUNT, AUTH, HEADERS, JOBS, K3S, LOGIN, MEDIA, NGINX, OFFSITE, STORAGE, TRANSCODE, UPLOAD } from "./policy";
import { DEFAULT_THEME, THEME_KEYS } from "./theme";

/**
 * Environment configuration (docs/architecture.md "설정과 환경 변수").
 * Every runtime setting is read here and nowhere else. Keys are split into groups that are
 * validated lazily when the subsystem first needs them, so the build does not require
 * database or secret values. `.env.example` must list exactly the keys defined below
 * (enforced by env.test.ts).
 */

type Source = Record<string, string | undefined>;

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const bool = z.stringbool();
/** A memory size Docker and systemd both read: "512M", "2G". */
const memorySize = z.string().regex(/^\d+[KMG]$/);
const cpus = z.coerce.number().positive().max(256);
const CIDR = /^(\d{1,3})(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/;
const cidrList = z
  .string()
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(CIDR, "must be a comma-separated list of IPv4 CIDRs, e.g. 192.168.0.0/24")));
const secret = (minLength: number) => z.string().min(minLength, `must be at least ${minLength} characters (run npm run env:secrets)`);
/** Decoded byte length of a base64 string, or -1 when it is not valid base64. */
function base64ByteLength(value: string): number {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
}
const base64Key32 = z
  .string()
  .refine((value) => base64ByteLength(value) === 32, "must be 32 random bytes encoded as base64 (run npm run env:secrets)");
const secondsList = z
  .string()
  .transform((value) => value.split(",").map((item) => Number(item.trim())))
  .pipe(z.array(z.number().int().positive()).min(1));

export const ENV_GROUPS = {
  app: z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_HOST: z.string().default("127.0.0.1"),
    APP_PORT: port.default(3000),
    PUBLIC_URL: z.url().default("http://localhost:3000"),
    DEFAULT_THEME: z.enum(THEME_KEYS).default(DEFAULT_THEME),
    SERVER_LOCATION: z.string().default("Seoul, KR"),
    ENABLE_UI_CATALOG: bool.default(false),
    ADMIN_ALLOWED_CIDRS: cidrList.default([]),
    /** "report-only" logs violations without blocking (to /api/csp-report); "enforce" blocks them. */
    CSP_MODE: z.enum(["report-only", "enforce"]).default("report-only"),
    /** Strict-Transport-Security max-age when PUBLIC_URL is https (0 = do not send it, e.g. Cloudflare already does). */
    HSTS_MAX_AGE_SEC: z.coerce.number().int().min(0).default(HEADERS.hstsMaxAgeSec),
    /** Adds includeSubDomains; only when every subdomain of PUBLIC_URL's domain is https. */
    HSTS_INCLUDE_SUBDOMAINS: bool.default(false),
  }),
  database: z.object({
    POSTGRES_HOST: z.string().default("localhost"),
    POSTGRES_PORT: port.default(5432),
    POSTGRES_DB: z.string().default("relayfiles"),
    POSTGRES_USER: z.string().default("relayfiles"),
    POSTGRES_PASSWORD: secret(16),
    POSTGRES_PUBLISH: z.string().default("127.0.0.1:5432"),
    DATABASE_URL: z.string().startsWith("postgresql://").optional(),
  }),
  redis: z.object({
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: port.default(6379),
    REDIS_PASSWORD: secret(16),
    REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_PUBLISH: z.string().default("127.0.0.1:6379"),
    REDIS_URL: z.string().startsWith("redis://").optional(),
    REDIS_KEY_PREFIX: z.string().default("rf:v1:"),
  }),
  storage: z.object({
    STORAGE_ROOT: z.string().default("./.data/relayfilesDB"),
    STORAGE_RESERVE_PERCENT: z.coerce.number().min(0).max(50).default(STORAGE.reservePercent),
    STORAGE_UID: positiveInt.default(10001),
    STORAGE_GID: positiveInt.default(10001),
    STORAGE_ACCEL_ENABLED: bool.default(false),
    STORAGE_ACCEL_PREFIX: z.string().startsWith("/").endsWith("/").default("/_protected/"),
    VOLUME_WATCH_INTERVAL_SEC: positiveInt.default(STORAGE.volumeWatchIntervalSec),
    /** Copies and re-uploads of the same content share their bytes (hard links on the volume). */
    STORAGE_DEDUPE: bool.default(true),
  }),
  uploads: z.object({
    UPLOAD_CHUNK_SIZE_MB: positiveInt.max(95).default(UPLOAD.chunkSizeMb),
    UPLOAD_MAX_FILE_SIZE_GB: z.coerce.number().positive().optional(),
    UPLOAD_TMP_TTL_HOURS: positiveInt.default(UPLOAD.tmpTtlHours),
  }),
  secrets: z.object({
    TOKEN_ENC_KEY: base64Key32,
    TOKEN_HMAC_KEY: secret(32),
    COOKIE_SECRET: secret(32),
    TOKEN_ENC_KEY_PREVIOUS: base64Key32.optional(),
    TOKEN_HMAC_KEY_PREVIOUS: secret(32).optional(),
    COOKIE_SECRET_PREVIOUS: secret(32).optional(),
  }),
  policy: z.object({
    ACCOUNT_TTL_DAYS: positiveInt.default(ACCOUNT.ttlDays),
    DEFAULT_QUOTA_GB: z.coerce.number().positive().default(ACCOUNT.defaultQuotaGb),
    /** Total storage all anonymous accounts may use together, in GB (unset = no total limit). */
    ANON_TOTAL_QUOTA_GB: z.coerce.number().positive().optional(),
    LOGIN_MAX_ATTEMPTS: positiveInt.default(LOGIN.maxAttempts),
    LOGIN_LOCK_SECONDS: secondsList.default([...LOGIN.lockSeconds]),
    SIGNUPS_PER_HOUR: positiveInt.default(AUTH.signupsPerHour),
  }),
  jobs: z.object({
    CLEANUP_CRON: z.string().default(JOBS.cleanupCron),
    JOBS_TIMEZONE: z.string().default(JOBS.timezone),
    METRICS_SAMPLE_INTERVAL_SEC: positiveInt.default(JOBS.metricsSampleIntervalSec),
    HEALTH_PROBE_INTERVAL_SEC: positiveInt.default(JOBS.healthProbeIntervalSec),
    /** Where the worker reaches the app for Status page probes; defaults to this host's APP_PORT. */
    HEALTH_PROBE_URL: z.url().optional(),
    MEDIA_WORKER_CONCURRENCY: positiveInt.max(16).default(MEDIA.workerConcurrency),
    FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
    /** Video conversions for unplayable containers running at once in the app (0 = off). */
    VIDEO_TRANSCODE_MAX: z.coerce.number().int().min(0).max(16).default(TRANSCODE.maxConcurrent),
  }),
  observability: z.object({
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
    LOG_DIR: z.string().default("/var/log/relayfiles"),
    /**
     * Which process writes the logs: its files in LOG_DIR are <name>-error.log and
     * <name>-combined.log, so the app, the worker and admin scripts never rotate each other's
     * files. The worker and scripts set it themselves (scripts/worker.mts, scripts/lib/bootstrap.mts).
     */
    LOG_SERVICE: z.enum(["app", "worker", "tools"]).default("app"),
    DISK_DEVICE: z.string().default("/dev/sda"),
    TLS_CERT_PATH: z.string().optional(),
  }),
  deploy: z.object({
    SERVER_NAME: z.string().default("localhost"),
    /** Host address Nginx is published on: 127.0.0.1 when another proxy on the host sits in front. */
    NGINX_LISTEN_HOST: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).default("0.0.0.0"),
    NGINX_LISTEN_PORT: port.default(80),
    /** Nginx request limits (both templates): body size in MB, and per-minute rates with bursts. */
    NGINX_MAX_BODY_MB: positiveInt.max(1_024).default(NGINX.maxBodyMb),
    NGINX_AUTH_RATE_PER_MIN: positiveInt.default(NGINX.authRatePerMin),
    NGINX_AUTH_BURST: positiveInt.default(NGINX.authBurst),
    NGINX_UPLOAD_RATE_PER_MIN: positiveInt.default(NGINX.uploadRatePerMin),
    NGINX_UPLOAD_BURST: positiveInt.default(NGINX.uploadBurst),
    CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
    /** Host directory for PostgreSQL, Redis and backups (docker compose). */
    DATA_DIR: z.string().startsWith("/").default("/srv/relayfiles"),
    /** Docker's data-root (images, containers, build cache); set by deploy/scripts/setup-docker.sh. */
    DOCKER_DATA_ROOT: z.string().startsWith("/").default("/var/lib/docker"),
    /** Private network of the compose services; cloudflared gets a fixed address in it. */
    DOCKER_SUBNET: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/).default("172.28.0.0/24"),
    CLOUDFLARED_IP: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).default("172.28.0.250"),
    /** Peer address of a proxy on the host (the DOCKER_SUBNET gateway); Nginx trusts its X-Real-IP. */
    TRUSTED_PROXY_IP: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).optional(),
    /** Container log rotation (docker compose json-file driver): size per file and files kept. */
    DOCKER_LOG_MAX_SIZE: z.string().regex(/^\d+[kmg]$/).default("10m"),
    DOCKER_LOG_MAX_FILE: positiveInt.default(5),
    /** Memory (K/M/G) and CPU cores the app and the worker may use (compose limits, systemd MemoryMax/CPUQuota). */
    APP_MEMORY_MAX: memorySize.default("2G"),
    APP_CPUS: cpus.default(3),
    WORKER_MEMORY_MAX: memorySize.default("2G"),
    WORKER_CPUS: cpus.default(2),
    /** k3s deployment (deploy/scripts/k3s/deploy.sh): GHCR image name without -app/-tools, namespace, app replicas. */
    K3S_IMAGE_REPO: z
      .string()
      .regex(/^[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)+$/, "must be a registry path such as ghcr.io/<owner>/relayfiles")
      .optional(),
    K3S_NAMESPACE: z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).default("relayfiles"),
    K3S_APP_REPLICAS: positiveInt.max(K3S.maxAppReplicas).default(1),
  }),
  offsite: z
    .object({
      /**
       * restic repository for deploy/scripts/offsite-backup.sh, e.g. an S3 bucket on Cloudflare R2
       * or Backblaze B2 (`s3:https://<endpoint>/<bucket>/relayfiles`). Empty: no offsite backup.
       */
      RESTIC_REPOSITORY: z
        .string()
        .regex(/^(s3|b2|sftp|rest|azure|gs|swift|rclone):/, "must start with a restic backend such as s3:")
        .optional(),
      /** Encrypts every offsite copy; keep a copy away from the server too, it cannot be recovered. */
      RESTIC_PASSWORD: z.string().min(OFFSITE.passwordMinLength).optional(),
      /** S3 credentials of the repository (passed to restic as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). */
      OFFSITE_ACCESS_KEY_ID: z.string().optional(),
      OFFSITE_SECRET_ACCESS_KEY: z.string().optional(),
      OFFSITE_KEEP_DAILY: positiveInt.default(OFFSITE.keepDaily),
      OFFSITE_KEEP_WEEKLY: positiveInt.default(OFFSITE.keepWeekly),
      OFFSITE_KEEP_MONTHLY: positiveInt.default(OFFSITE.keepMonthly),
      OFFSITE_CHECK_PERCENT: z.coerce.number().positive().max(100).default(OFFSITE.checkPercent),
      /** More directories to back up, space-separated (the users/ folders of extra volumes). */
      OFFSITE_EXTRA_PATHS: z
        .string()
        .regex(/^\/\S*( \/\S*)*$/, "must be absolute paths separated by spaces")
        .optional(),
    })
    .refine((env) => !env.RESTIC_REPOSITORY || env.RESTIC_PASSWORD, { message: "RESTIC_PASSWORD is required with RESTIC_REPOSITORY", path: ["RESTIC_PASSWORD"] }),
  testing: z.object({
    E2E_PORT: port.default(3100),
    E2E_BASE_URL: z.url().optional(),
    PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
  }),
} as const;

export type EnvGroup = keyof typeof ENV_GROUPS;
export type GroupEnv<G extends EnvGroup> = z.infer<(typeof ENV_GROUPS)[G]>;

/** All keys defined across groups (used to keep `.env.example` in sync). */
export const ENV_KEYS: readonly string[] = Object.values(ENV_GROUPS).flatMap((schema) => Object.keys(schema.shape));

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "EnvError";
  }
}

/** Empty strings in `.env` mean "not set" so defaults apply. */
function withoutEmpty(source: Source): Source {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ""));
}

/** Validates one group of a raw environment record. Pure, so it can be unit tested. */
export function parseEnvGroup<G extends EnvGroup>(group: G, source: Source): GroupEnv<G> {
  const result = ENV_GROUPS[group].safeParse(withoutEmpty(source));
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => {
        const missing = issue.code === "invalid_type" && /received undefined/.test(issue.message);
        return `${issue.path.join(".") || group}: ${missing ? "is required (see .env.example)" : issue.message}`;
      }),
    );
  }
  return result.data as GroupEnv<G>;
}

/** Validates every group and returns all problems at once (used by `npm run env:check`). */
export function checkAllEnv(source: Source): string[] {
  return (Object.keys(ENV_GROUPS) as EnvGroup[]).flatMap((group) => {
    try {
      parseEnvGroup(group, source);
      return [];
    } catch (error) {
      return error instanceof EnvError ? error.issues.map((issue) => `[${group}] ${issue}`) : [`[${group}] ${String(error)}`];
    }
  });
}

const cache = new Map<EnvGroup, unknown>();

/** Lazily validated process environment for one group (fails fast on first access). */
export function getEnv<G extends EnvGroup>(group: G): GroupEnv<G> {
  if (!cache.has(group)) cache.set(group, parseEnvGroup(group, process.env));
  return cache.get(group) as GroupEnv<G>;
}

export const getAppEnv = () => getEnv("app");

/** Effective log level: explicit LOG_LEVEL, otherwise `warn` in production and `debug` elsewhere. */
export function logLevelOf(nodeEnv: GroupEnv<"app">["NODE_ENV"], observability: GroupEnv<"observability">): NonNullable<GroupEnv<"observability">["LOG_LEVEL"]> {
  return observability.LOG_LEVEL ?? (nodeEnv === "production" ? "warn" : "debug");
}

/** PostgreSQL connection string: explicit DATABASE_URL, otherwise built from the parts. */
export function databaseUrlOf(db: GroupEnv<"database">): string {
  if (db.DATABASE_URL) return db.DATABASE_URL;
  const user = encodeURIComponent(db.POSTGRES_USER);
  const password = encodeURIComponent(db.POSTGRES_PASSWORD);
  return `postgresql://${user}:${password}@${db.POSTGRES_HOST}:${db.POSTGRES_PORT}/${db.POSTGRES_DB}?schema=public`;
}

/** Redis connection string: explicit REDIS_URL, otherwise built from the parts. */
export function redisUrlOf(redis: GroupEnv<"redis">): string {
  if (redis.REDIS_URL) return redis.REDIS_URL;
  return `redis://:${encodeURIComponent(redis.REDIS_PASSWORD)}@${redis.REDIS_HOST}:${redis.REDIS_PORT}/${redis.REDIS_DB}`;
}

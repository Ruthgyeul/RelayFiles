import { z } from "zod";
import { appEnv, testingEnv } from "./env/app";
import { databaseEnv, redisEnv } from "./env/services";
import { storageEnv, uploadsEnv } from "./env/storage";
import { secretsEnv } from "./env/secrets";
import { policyEnv, jobsEnv, observabilityEnv } from "./env/runtime";
import { deployEnv, offsiteEnv, notifyEnv } from "./env/deploy";
import type { Source } from "./env/fields";

/**
 * Environment configuration (docs/architecture.md "설정과 환경 변수").
 * Every runtime setting is read here and nowhere else. Keys are split into groups that are
 * validated lazily when the subsystem first needs them, so the build does not require
 * database or secret values. The group schemas live in src/config/env/; `.env.example` must
 * list exactly their keys (enforced by env.test.ts).
 */

// Field schemas and the groups are split under src/config/env/; this file assembles and reads them.
export { isLanHost, NOTIFY_FORMATS } from "./env/fields";

export const ENV_GROUPS = {
  app: appEnv,
  database: databaseEnv,
  redis: redisEnv,
  storage: storageEnv,
  uploads: uploadsEnv,
  secrets: secretsEnv,
  policy: policyEnv,
  jobs: jobsEnv,
  observability: observabilityEnv,
  deploy: deployEnv,
  offsite: offsiteEnv,
  notify: notifyEnv,
  testing: testingEnv,
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

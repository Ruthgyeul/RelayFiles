import { z } from "zod";
import { DEFAULT_THEME, THEME_KEYS } from "./theme";

/**
 * Server environment schema. Every runtime setting is read here and nowhere else.
 * Infrastructure keys (database, Redis, storage, secrets) are added with the milestone
 * that introduces them; see docs/plan.md.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_URL: z.url().default("http://localhost:3000"),
  DEFAULT_THEME: z.enum(THEME_KEYS).default(DEFAULT_THEME),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join("\n- ")}`);
    this.name = "EnvError";
  }
}

/** Validates a raw environment record. Pure, so it can be unit tested. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validated process environment (fails fast on first access). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Effective log level: explicit LOG_LEVEL, otherwise `warn` in production and `debug` elsewhere. */
export function logLevelOf(env: Env): NonNullable<Env["LOG_LEVEL"]> {
  return env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "warn" : "debug");
}

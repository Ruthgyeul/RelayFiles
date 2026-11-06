/** Environment group schemas: postgreSQL and Redis connections. Assembled in src/config/env.ts. */
import { z } from "zod";
import { port, secret } from "./fields";

export const databaseEnv = z.object({
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: port.default(5432),
  POSTGRES_DB: z.string().default("relayfiles"),
  POSTGRES_USER: z.string().default("relayfiles"),
  POSTGRES_PASSWORD: secret(16),
  POSTGRES_PUBLISH: z.string().default("127.0.0.1:5432"),
  DATABASE_URL: z.string().startsWith("postgresql://").optional(),
});

export const redisEnv = z.object({
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: port.default(6379),
  REDIS_PASSWORD: secret(16),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_PUBLISH: z.string().default("127.0.0.1:6379"),
  REDIS_URL: z.string().startsWith("redis://").optional(),
  REDIS_KEY_PREFIX: z.string().default("rf:v1:"),
});

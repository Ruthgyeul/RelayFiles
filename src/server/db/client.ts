import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlOf, getEnv } from "@/config/env";
import { MS, STORAGE } from "@/config/policy";
import { PrismaClient, type Prisma } from "./generated/client";

function createPrisma(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, errorFormat: "minimal", transactionOptions: { timeout: STORAGE.transactionTimeoutSec * MS.second } });
}

/**
 * A separate connection to another database with this schema (backup verification reads a
 * scratch copy restored from a dump). The caller disconnects it.
 */
export function openDatabase(connectionString: string): PrismaClient {
  return createPrisma(connectionString);
}

const globalForPrisma = globalThis as unknown as { relayPrisma?: PrismaClient };

/** Shared Prisma client. Reused across hot reloads in development. */
export function db(): PrismaClient {
  globalForPrisma.relayPrisma ??= createPrisma(databaseUrlOf(getEnv("database")));
  return globalForPrisma.relayPrisma;
}

export { Prisma } from "./generated/client";
export type { PrismaClient } from "./generated/client";

/** Either the shared client or an interactive transaction; repositories accept both. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

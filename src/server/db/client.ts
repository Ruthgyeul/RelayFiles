import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlOf, getEnv } from "@/config/env";
import { PrismaClient, type Prisma } from "./generated/client";

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrlOf(getEnv("database")) });
  return new PrismaClient({ adapter, errorFormat: "minimal" });
}

const globalForPrisma = globalThis as unknown as { relayPrisma?: PrismaClient };

/** Shared Prisma client. Reused across hot reloads in development. */
export function db(): PrismaClient {
  globalForPrisma.relayPrisma ??= createPrisma();
  return globalForPrisma.relayPrisma;
}

export { Prisma } from "./generated/client";
export type { PrismaClient } from "./generated/client";

/** Either the shared client or an interactive transaction; repositories accept both. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrlOf, getEnv } from "@/config/env";
import { MS, STORAGE } from "@/config/policy";
import { PrismaClient } from "@/server/db/generated/client";

/**
 * Makes the shared Prisma client (`db()`) one that counts the SQL statements it sends, for
 * tests that check how many queries an operation runs. Call it before anything uses `db()`.
 */
export function countQueries() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrlOf(getEnv("database")) }),
    errorFormat: "minimal",
    transactionOptions: { timeout: STORAGE.transactionTimeoutSec * MS.second },
    log: [{ emit: "event", level: "query" }],
  });
  const statements: string[] = [];
  client.$on("query", (event) => statements.push(event.query));
  (globalThis as { relayPrisma?: PrismaClient }).relayPrisma = client;

  /** Runs `work` and returns its result with the statements it sent (transaction BEGIN/COMMIT included). */
  async function measure<T>(work: () => Promise<T>): Promise<{ result: T; queries: number; ms: number; statements: string[] }> {
    const from = statements.length;
    const started = performance.now();
    const result = await work();
    const ms = Math.round(performance.now() - started);
    // Query events are emitted after each statement returns; let the last one arrive.
    await new Promise((resolve) => setImmediate(resolve));
    const sent = statements.slice(from);
    return { result, queries: sent.length, ms, statements: sent };
  }

  return { client, measure };
}

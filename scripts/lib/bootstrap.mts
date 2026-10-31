/**
 * Start and end shared by the npm scripts that use the app (admin, storage, volume, data).
 * Importing this module loads .env the way Next does, so it must come before any app module
 * is imported (scripts import those dynamically, after it). `runScript` runs the body.
 */
import nextEnv from "@next/env";

// Admin scripts log to tools-*.log (the worker sets "worker" before importing this).
process.env.LOG_SERVICE ||= "tools";
nextEnv.loadEnvConfig(process.cwd());

/**
 * Runs a script body and exits with its result (0 when it returns nothing). A thrown error is
 * printed as its message, for the operator, and exits 1. The database and Redis connections
 * are closed either way: an open handle would keep the process alive.
 */
export async function runScript(main: () => Promise<number | void>): Promise<never> {
  let exitCode = 1;
  try {
    exitCode = (await main()) ?? 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    await closeConnections();
  }
  process.exit(exitCode);
}

async function closeConnections(): Promise<void> {
  const [{ db }, { closeRedis }] = await Promise.all([import("../../src/server/db/client"), import("../../src/server/redis")]);
  try {
    await db().$disconnect();
  } finally {
    closeRedis();
  }
}

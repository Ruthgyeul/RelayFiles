import "server-only";
import { DB_WRITE } from "@/config/policy";
import { Prisma } from "./client";

/** A unique index refused the write (Prisma P2002): the name or id is already taken. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Runs `write` again when a unique index refuses it: a random id or token that collided, or a
 * row a parallel request created first (the next try sees it). Gives up after
 * DB_WRITE.uniqueRetryAttempts tries; other errors pass straight through.
 */
export async function retryOnUniqueViolation<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= DB_WRITE.uniqueRetryAttempts) throw error;
    }
  }
}

import "server-only";
import { DB_WRITE } from "@/config/policy";
import { Prisma } from "./client";

/** Shape of a raw query's driver error (Prisma P2010) when PostgreSQL refused the write. */
interface RawQueryMeta {
  driverAdapterError?: { cause?: { kind?: string } };
}

/**
 * A unique index refused the write: the name or id is already taken. Model queries report it as
 * P2002, raw queries ($executeRaw, e.g. renumbering) as P2010 with the driver's
 * UniqueConstraintViolation.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002") return true;
  return error.code === "P2010" && (error.meta as RawQueryMeta | undefined)?.driverAdapterError?.cause?.kind === "UniqueConstraintViolation";
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

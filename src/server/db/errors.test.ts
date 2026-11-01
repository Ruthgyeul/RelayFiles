import { describe, expect, it, vi } from "vitest";
import { DB_WRITE } from "@/config/policy";
import { Prisma } from "./client";
import { isLockTimeout, isUniqueViolation, retryOnUniqueViolation } from "./errors";

const unique = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
const rawFailure = (kind: string) =>
  new Prisma.PrismaClientKnownRequestError("Raw query failed", { code: "P2010", clientVersion: "test", meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind, originalCode: "23505" } } } });
const missing = () => new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "test" });

describe("lock timeouts", () => {
  it("recognises a raw query that passed lock_timeout only", () => {
    const timedOut = new Prisma.PrismaClientKnownRequestError("Raw query failed", { code: "P2010", clientVersion: "test", meta: { driverAdapterError: { cause: { kind: "postgres", originalCode: "55P03" } } } });
    expect(isLockTimeout(timedOut)).toBe(true);
    expect(isLockTimeout(rawFailure("UniqueConstraintViolation"))).toBe(false);
    expect(isLockTimeout(unique())).toBe(false);
    expect(isLockTimeout(new Error("55P03"))).toBe(false);
  });
});

describe("unique violations", () => {
  it("recognises P2002 and a raw query's unique constraint violation only", () => {
    expect(isUniqueViolation(unique())).toBe(true);
    expect(isUniqueViolation(rawFailure("UniqueConstraintViolation"))).toBe(true);
    expect(isUniqueViolation(rawFailure("ForeignKeyConstraintViolation"))).toBe(false);
    expect(isUniqueViolation(missing())).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
  });

  it("retries a refused write until it succeeds", async () => {
    const write = vi.fn<() => Promise<string>>().mockRejectedValueOnce(unique()).mockResolvedValueOnce("ok");
    await expect(retryOnUniqueViolation(write)).resolves.toBe("ok");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured tries and passes other errors through at once", async () => {
    const always = vi.fn<() => Promise<string>>().mockRejectedValue(unique());
    await expect(retryOnUniqueViolation(always)).rejects.toSatisfy(isUniqueViolation);
    expect(always).toHaveBeenCalledTimes(DB_WRITE.uniqueRetryAttempts);

    const error = missing();
    const other = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    await expect(retryOnUniqueViolation(other)).rejects.toBe(error);
    expect(other).toHaveBeenCalledTimes(1);
  });
});

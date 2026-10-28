import { describe, expect, it, vi } from "vitest";
import { DB_WRITE } from "@/config/policy";
import { Prisma } from "./client";
import { isUniqueViolation, retryOnUniqueViolation } from "./errors";

const unique = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
const missing = () => new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "test" });

describe("unique violations", () => {
  it("recognises only P2002", () => {
    expect(isUniqueViolation(unique())).toBe(true);
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

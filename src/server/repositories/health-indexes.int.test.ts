import { afterAll, describe, expect, it } from "vitest";
import { fileFixtures } from "../../../test/file-fixtures";
import { pruneHealth } from "./health.repo";

const { prisma, cleanup } = fileFixtures();

afterAll(cleanup);

/** The plan of a statement when the table may not be read in order (as on a large table). */
async function planOf(query: string, ...values: unknown[]): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${query}`, ...values);
  });
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("health sample cleanup", () => {
  it("deletes old samples of every component through the index on their time", async () => {
    const component = `test-${Date.now()}`;
    const old = new Date("2000-01-01T00:00:00Z");
    await prisma.healthSample.createMany({ data: [{ component, at: old, ok: true }, { component, at: new Date(), ok: true }] });

    await pruneHealth(prisma, new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));
    expect(await prisma.healthSample.count({ where: { component } })).toBe(1);
    expect(await planOf(`DELETE FROM "HealthSample" WHERE "at" < $1`, new Date())).toContain("HealthSample_at_idx");
    await prisma.healthSample.deleteMany({ where: { component } });
  });
});

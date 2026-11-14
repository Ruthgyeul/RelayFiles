import { afterAll, describe, expect, it } from "vitest";
import { fileFixtures } from "../../../test/file-fixtures";
import { accountUsage, largestFiles, recentFiles } from "./node.repo";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

/**
 * The plan PostgreSQL picks for a query when it may not read the table pages in order (with one
 * account holding nearly every row, reading the table would otherwise be cheapest).
 */
async function planOf(query: string, ...values: unknown[]): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    await tx.$executeRaw`SET LOCAL enable_bitmapscan = off`;
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${query}`, ...values);
  });
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("account usage", () => {
  it("sums the account's files from the index alone and lists the largest from it", async () => {
    const m = await member();
    await prisma.$executeRaw`
      INSERT INTO "Node" (id, "accountId", "parentId", type, name, size, "linkId", "updatedAt")
      SELECT md5(random()::text || g::text), ${m.id}, ${m.rootId}, 'FILE', 'file-' || g, g, md5(random()::text || g::text || 'l'), now()
      FROM generate_series(1, 2000) AS g`;
    // Autovacuum keeps the visibility map current on a real server; an index-only scan relies on it.
    await prisma.$executeRaw`VACUUM (ANALYZE) "Node"`;

    expect(await accountUsage(prisma, m.id)).toEqual({ usedBytes: 2_001_000n, rootItems: 2000 });
    expect((await largestFiles(prisma, m.id, 2)).map((row) => row.name)).toEqual(["file-2000", "file-1999"]);

    expect(await planOf(`SELECT sum(size) FROM "Node" WHERE "accountId" = $1 AND type = 'FILE'`, m.id)).toMatch(/Index Only Scan using "Node_accountId_type_size_idx"/);
    expect(await planOf(`SELECT id FROM "Node" WHERE "accountId" = $1 AND type = 'FILE' AND size > 0 ORDER BY size DESC, id LIMIT 2`, m.id)).toContain("Node_accountId_type_size_idx");
    await prisma.node.deleteMany({ where: { accountId: m.id, parentId: m.rootId } });
  });

  it("reads the newest files in order from the index, the same files every time", async () => {
    const m = await member();
    // One timestamp for all: the id decides, so the list does not change between reads.
    await prisma.$executeRaw`
      INSERT INTO "Node" (id, "accountId", "parentId", type, name, size, "linkId", "createdAt", "updatedAt")
      SELECT 'recent' || lpad(g::text, 6, '0'), ${m.id}, ${m.rootId}, 'FILE', 'r-' || g, 1, md5(random()::text || g::text), timestamp '2026-01-01', now()
      FROM generate_series(1, 1000) AS g`;
    await prisma.$executeRaw`VACUUM (ANALYZE) "Node"`;

    expect((await recentFiles(prisma, m.id, 3)).map((row) => row.name)).toEqual(["r-1000", "r-999", "r-998"]);
    const plan = await planOf(`SELECT id FROM "Node" WHERE "accountId" = $1 AND type = 'FILE' ORDER BY "createdAt" DESC, id DESC LIMIT 3`, m.id);
    expect(plan).toContain("Node_accountId_type_createdAt_id_idx");
    expect(plan).not.toContain("Sort");
    await prisma.node.deleteMany({ where: { accountId: m.id, parentId: m.rootId } });
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { SEARCH } from "@/config/policy";
import { fileFixtures } from "../../../test/file-fixtures";
import { findByName } from "./node.repo";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

describe("name search", () => {
  it("finds names by any part, in any case, with the trigram index", async () => {
    const m = await member();
    await prisma.$executeRaw`
      INSERT INTO "Node" (id, "accountId", "parentId", type, name, "linkId", "updatedAt")
      SELECT md5(random()::text || g::text), ${m.id}, ${m.rootId}, 'FILE', 'holiday-' || g || '.jpg', md5(random()::text || g::text || 'l'), now()
      FROM generate_series(1, 5000) AS g`;
    await prisma.$executeRaw`ANALYZE "Node"`;

    const hits = await findByName(prisma, m.id, "DAY-4999", SEARCH.nameCandidates);
    expect(hits.map((row) => row.name)).toEqual(["holiday-4999.jpg"]);

    // The ILIKE '%…%' that Prisma's case-insensitive contains sends can be answered from the index.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN SELECT id FROM "Node" WHERE name ILIKE ${"%day-4999%"}`;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Node_name_idx");
    await prisma.node.deleteMany({ where: { accountId: m.id, parentId: m.rootId } });
  });
});

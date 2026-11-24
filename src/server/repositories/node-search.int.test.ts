import { afterAll, describe, expect, it } from "vitest";
import { MS, SEARCH } from "@/config/policy";
import { newLinkId, newNodeId } from "@/domain/ids";
import { fileFixtures } from "../../../test/file-fixtures";
import { searchNodes } from "./node.repo";

const byName = (text: string) => ({ text, tags: [], kinds: [], newerThan: null, olderThan: null });

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

    const hits = await searchNodes(prisma, m.id, byName("DAY-4999"), SEARCH.nameCandidates);
    expect(hits.map((row) => row.name)).toEqual(["holiday-4999.jpg"]);

    // The ILIKE '%…%' that Prisma's case-insensitive contains sends can be answered from the index.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN SELECT id FROM "Node" WHERE name ILIKE ${"%day-4999%"}`;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("Node_name_idx");
    await prisma.node.deleteMany({ where: { accountId: m.id, parentId: m.rootId } });
  });

  it("combines kinds, tags and the date modified (date added without one)", async () => {
    const m = await member();
    const at = (days: number) => new Date(Date.now() - days * MS.day);
    type Data = { type: "FILE" | "FOLDER"; kind?: "IMAGE" | "VIDEO" | "OTHER"; tags?: string[]; modifiedAt?: Date; createdAt?: Date };
    const row = (name: string, data: Data) => ({ id: newNodeId(), linkId: newLinkId(), accountId: m.id, parentId: m.rootId, name, ...data });
    await prisma.node.createMany({
      data: [
        row("beach.jpg", { type: "FILE", kind: "IMAGE", tags: ["trip"], modifiedAt: at(3) }),
        row("old-beach.jpg", { type: "FILE", kind: "IMAGE", tags: ["trip"], modifiedAt: at(400), createdAt: at(1) }),
        row("beach.mp4", { type: "FILE", kind: "VIDEO", tags: ["trip"], createdAt: at(10) }),
        row("Beach", { type: "FOLDER", tags: ["trip"], createdAt: at(500) }),
        row("notes.txt", { type: "FILE", kind: "OTHER", modifiedAt: at(3) }),
      ],
    });
    const names = async (search: Partial<Parameters<typeof searchNodes>[2]>) => (await searchNodes(prisma, m.id, { ...byName(""), ...search }, SEARCH.tagResultLimit)).map((hit) => hit.name).sort();

    expect(await names({ text: "beach", kinds: ["image"] })).toEqual(["beach.jpg", "old-beach.jpg"]);
    expect(await names({ tags: ["trip"], kinds: ["video", "folder"] })).toEqual(["Beach", "beach.mp4"]);
    expect(await names({ tags: ["trip"], newerThan: at(30) })).toEqual(["beach.jpg", "beach.mp4"]);
    expect(await names({ olderThan: at(365) })).toEqual(["Beach", "old-beach.jpg"]);
    expect(await names({ text: "beach", kinds: ["other"] })).toEqual([]);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { fileFixtures } from "../../../test/file-fixtures";
import { existingFilePaths } from "./node-tree.repo";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

describe("existingFilePaths", () => {
  it("finds the batch's paths that are files already, at any depth, in this account's folder only", async () => {
    const m = await member();
    const folder = async (parentId: string, name: string) => (await prisma.node.create({ data: { id: `f${Math.random().toString(36).slice(2, 13)}`, accountId: m.id, parentId, type: "FOLDER", name, linkId: `l${Math.random().toString(36).slice(2, 13)}` } })).id;
    const a = await folder(m.rootId, "a");
    const b = await folder(a, "b");
    await prisma.$executeRaw`
      INSERT INTO "Node" (id, "accountId", "parentId", type, name, size, "linkId", "updatedAt")
      SELECT md5(random()::text || g::text), ${m.id}, ${b}, 'FILE', CASE WHEN g = 1 THEN 'c.txt' ELSE 'other-' || g || '.txt' END, 1, md5(random()::text || g::text || 'l'), now()
      FROM generate_series(1, 3000) AS g`;
    await prisma.node.create({ data: { id: "rootfile0001", accountId: m.id, parentId: m.rootId, type: "FILE", name: "x.txt", linkId: "rootfilelnk1" } });

    const found = await existingFilePaths(prisma, m.rootId, ["a/b/c.txt", "a/b/d.txt", "a/b", "a", "x.txt", "y/x.txt", "a/b/c.txt"]);
    expect([...found].sort()).toEqual(["a/b/c.txt", "x.txt"]);
    expect(await existingFilePaths(prisma, m.rootId, [])).toEqual(new Set());
    // Another account's folder holds none of them.
    expect(await existingFilePaths(prisma, (await member()).rootId, ["a/b/c.txt"])).toEqual(new Set());

    await prisma.node.deleteMany({ where: { accountId: m.id, NOT: { id: m.rootId } } });
  });
});

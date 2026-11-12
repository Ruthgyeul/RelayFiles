import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { newLinkId, newNodeId } from "@/domain/ids";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../test/file-fixtures";
import { POST as renameBatch } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const rename = (m: FixtureMember, items: { id: string; name: string }[]) => callRoute<{ renamed: number }>(renameBatch, { method: "POST", cookie: m.cookie, body: { items } });
const namesOf = async (m: FixtureMember, parentId: string) => (await prisma.node.findMany({ where: { accountId: m.id, parentId }, select: { name: true } })).map((row) => row.name).sort();

async function folderIn(m: FixtureMember, parentId: string, name: string) {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, linkId: newLinkId() } });
  await mkdir(join(m.dir, name), { recursive: true });
  return id;
}

describe("batch rename", () => {
  it("renames several items in the database and on disk", async () => {
    const m = await member();
    const a = await addFile(m, m.rootId, [], "a.txt", "A", "text/plain");
    const b = await addFile(m, m.rootId, [], "b.txt", "B", "text/plain");
    const docs = await folderIn(m, m.rootId, "Docs");
    const res = await rename(m, [
      { id: a, name: "01 a.txt" },
      { id: b, name: "b.txt" },
      { id: docs, name: "Papers" },
    ]);
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ renamed: 2 });
    expect(await namesOf(m, m.rootId)).toEqual(["01 a.txt", "Papers", "b.txt"]);
    expect((await readdir(m.dir)).sort()).toEqual(["01 a.txt", "Papers", "b.txt"]);
    // The node keeps its id, so its link and settings stay.
    expect((await prisma.node.findUniqueOrThrow({ where: { id: a } })).name).toBe("01 a.txt");
  });

  it("swaps two names", async () => {
    const m = await member();
    const a = await addFile(m, m.rootId, [], "a.txt", "content of a", "text/plain");
    const b = await addFile(m, m.rootId, [], "b.txt", "content of b", "text/plain");
    expect(
      (
        await rename(m, [
          { id: a, name: "b.txt" },
          { id: b, name: "a.txt" },
        ])
      ).json.data,
    ).toEqual({ renamed: 2 });
    expect(await readFile(join(m.dir, "b.txt"), "utf8")).toBe("content of a");
    expect(await readFile(join(m.dir, "a.txt"), "utf8")).toBe("content of b");
  });

  it("refuses a name taken outside the selection and renames nothing", async () => {
    const m = await member();
    const a = await addFile(m, m.rootId, [], "a.txt", "A", "text/plain");
    const b = await addFile(m, m.rootId, [], "b.txt", "B", "text/plain");
    await addFile(m, m.rootId, [], "taken.txt", "T", "text/plain");
    const res = await rename(m, [
      { id: a, name: "x.txt" },
      { id: b, name: "taken.txt" },
    ]);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('"taken.txt" already exists here.');
    expect(await namesOf(m, m.rootId)).toEqual(["a.txt", "b.txt", "taken.txt"]);
    expect((await readdir(m.dir)).sort()).toEqual(["a.txt", "b.txt", "taken.txt"]);
  });

  it("refuses invalid and duplicate names, items of two folders and other accounts' items", async () => {
    const m = await member();
    const other = await member();
    const a = await addFile(m, m.rootId, [], "a.txt", "A", "text/plain");
    const b = await addFile(m, m.rootId, [], "b.txt", "B", "text/plain");
    const docs = await folderIn(m, m.rootId, "Docs");
    const inner = await addFile(m, docs, ["Docs"], "c.txt", "C", "text/plain");
    const foreign = await addFile(other, other.rootId, [], "z.txt", "Z", "text/plain");

    expect((await rename(m, [{ id: a, name: "x/y.txt" }])).status).toBe(400);
    expect(
      (
        await rename(m, [
          { id: a, name: "same.txt" },
          { id: b, name: "same.txt" },
        ])
      ).status,
    ).toBe(400);
    const mixed = await rename(m, [
      { id: a, name: "1.txt" },
      { id: inner, name: "2.txt" },
    ]);
    expect(mixed.status).toBe(400);
    expect(mixed.json.error).toBe("Rename items of one folder at a time.");
    expect((await rename(m, [{ id: foreign, name: "mine.txt" }])).status).toBe(404);
    expect((await rename(m, [{ id: m.rootId, name: "Home" }])).status).toBe(400);
    expect(await namesOf(other, other.rootId)).toEqual(["z.txt"]);
    expect(await namesOf(m, m.rootId)).toEqual(["Docs", "a.txt", "b.txt"]);
  });
});

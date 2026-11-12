import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MS, STORAGE_VIEW } from "@/config/policy";
import type { StorageOverview } from "@/contracts/storage";
import { newLinkId, newNodeId } from "@/domain/ids";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../test/file-fixtures";
import { GET as storage } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const overviewOf = async (m: FixtureMember) => (await callRoute<StorageOverview>(storage, { cookie: m.cookie })).json.data;

async function folderIn(m: FixtureMember, parentId: string, name: string) {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, linkId: newLinkId() } });
  return id;
}

const ago = (days: number) => new Date(Date.now() - days * MS.day);

describe("storage overview", () => {
  it("shows what the top of the root holds, the largest files and the trash", async () => {
    const m = await member();
    const other = await member();
    const photos = await folderIn(m, m.rootId, "Photos");
    await addFile(m, photos, ["Photos"], "big.jpg", "x".repeat(300), "image/jpeg");
    await addFile(m, photos, ["Photos"], "small.jpg", "x".repeat(20), "image/jpeg");
    await addFile(m, m.rootId, [], "notes.txt", "x".repeat(80), "text/plain");
    await folderIn(m, m.rootId, "Empty");
    await prisma.trashedBytes.create({ data: { id: randomUUID(), accountId: m.id, bytes: 45n } });
    await addFile(other, other.rootId, [], "huge.bin", "x".repeat(900), "application/octet-stream");

    const overview = await overviewOf(m);
    expect(overview).toMatchObject({ usedBytes: "400", trashBytes: "45", staleAfterDays: STORAGE_VIEW.staleAfterDays });
    expect(overview.bars.map((bar) => [bar.name, bar.bytes, bar.percent])).toEqual([
      ["Photos", "320", 80],
      ["notes.txt", "80", 20],
    ]);
    expect(overview.largest.map((item) => [item.name, item.parentPath])).toEqual([
      ["big.jpg", "root / Photos"],
      ["notes.txt", "root"],
      ["small.jpg", "root / Photos"],
    ]);
  });

  it("lists old files without share-link activity since, not newer or recently downloaded ones", async () => {
    const m = await member();
    const old = await addFile(m, m.rootId, [], "old.txt", "old", "text/plain");
    const downloaded = await addFile(m, m.rootId, [], "downloaded.txt", "dl", "text/plain");
    const openedLongAgo = await addFile(m, m.rootId, [], "opened-long-ago.txt", "ol", "text/plain");
    await addFile(m, m.rootId, [], "new.txt", "new", "text/plain");
    const longAgo = ago(STORAGE_VIEW.staleAfterDays + 30);
    await prisma.node.updateMany({ where: { id: { in: [old, downloaded, openedLongAgo] } }, data: { createdAt: longAgo } });
    await prisma.linkEvent.create({ data: { nodeId: downloaded, kind: "DOWNLOAD", fileName: "downloaded.txt", at: ago(3) } });
    await prisma.linkEvent.create({ data: { nodeId: openedLongAgo, kind: "VIEW", fileName: "opened-long-ago.txt", at: ago(STORAGE_VIEW.staleAfterDays + 10) } });
    // A link reset is not someone using the file.
    await prisma.linkEvent.create({ data: { nodeId: old, kind: "RESET", fileName: "old.txt", at: ago(1) } });

    expect((await overviewOf(m)).stale.map((item) => item.name).sort()).toEqual(["old.txt", "opened-long-ago.txt"]);
  });

  it("needs a signed-in account", async () => {
    expect((await callRoute(storage, {})).status).toBe(401);
  });
});

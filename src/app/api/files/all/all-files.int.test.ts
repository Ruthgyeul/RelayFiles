import { afterAll, describe, expect, it } from "vitest";
import type { AllFilesPage } from "@/contracts/all-files";
import type { FolderView } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { closeQueues } from "@/server/jobs/queue";
import { countQueries } from "../../../../../test/query-counter";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../test/file-fixtures";

// Before fileFixtures(), which takes the shared client.
const { measure } = countQueries();
const { prisma, member, addFile, cleanup } = fileFixtures();
const { GET: allFiles } = await import("./route");
const { GET: folderView } = await import("@/app/api/folders/[id]/route");

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

async function folder(m: FixtureMember, parentId: string, name: string) {
  const id = newNodeId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, linkId: newLinkId() } });
  return id;
}

/** root: b.txt · Trip/ (a.jpg, Day1/ (c.mp4)) · Empty/ */
async function account() {
  const m = await member();
  const trip = await folder(m, m.rootId, "Trip");
  const day = await folder(m, trip, "Day1");
  await folder(m, m.rootId, "Empty");
  const b = await addFile(m, m.rootId, [], "b.txt", "bravo bravo", "text/plain");
  const a = await addFile(m, trip, ["Trip"], "a.jpg", "a", "image/jpeg", "IMAGE");
  const c = await addFile(m, day, ["Trip", "Day1"], "c.mp4", "charlie charlie charlie", "video/mp4", "VIDEO");
  // Oldest a, then b, then c (date added).
  for (const [id, at] of [[a, 1_000], [b, 2_000], [c, 3_000]] as const) await prisma.node.update({ where: { id }, data: { createdAt: new Date(at) } });
  await prisma.node.update({ where: { id: c }, data: { tags: ["trip"] } });
  return { m, a, b, c, trip };
}

const page = (m: FixtureMember, query = "") => callRoute<AllFilesPage>(allFiles, { cookie: m.cookie, query });
const names = (result: { json: { data: AllFilesPage } }) => result.json.data.items.map((item) => item.name);

describe("all files", () => {
  it("lists every file at any depth without folders, with where each one is", async () => {
    const { m } = await account();
    const first = await page(m);
    expect(first.status).toBe(200);
    expect(names(first)).toEqual(["c.mp4", "b.txt", "a.jpg"]);
    expect(first.json.data.items.map((item) => [item.name, item.parentPath])).toEqual([
      ["c.mp4", "root / Trip / Day1"],
      ["b.txt", "root"],
      ["a.jpg", "root / Trip"],
    ]);
    expect(first.json.data.counts).toEqual({ all: 3, video: 1, audio: 0, image: 1, other: 1 });
    expect(first.json.data.nextCursor).toBeNull();
    // The root's entry counts them too.
    const root = await callRoute<FolderView, { id: string }>(folderView, { cookie: m.cookie, params: { id: "root" } });
    expect(root.json.data.allFileCount).toBe(3);
  });

  it("sorts and pages without gaps or repeats, in every order", async () => {
    const { m } = await account();
    const expected: Record<string, string[]> = {
      date: ["c.mp4", "b.txt", "a.jpg"],
      "date-asc": ["a.jpg", "b.txt", "c.mp4"],
      name: ["a.jpg", "b.txt", "c.mp4"],
      "name-desc": ["c.mp4", "b.txt", "a.jpg"],
      size: ["c.mp4", "b.txt", "a.jpg"],
      "size-asc": ["a.jpg", "b.txt", "c.mp4"],
    };
    for (const [sort, order] of Object.entries(expected)) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const next: { json: { data: AllFilesPage } } = await page(m, `?sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        seen.push(...names(next));
        // Counted on the first page only.
        if (cursor) expect(next.json.data.counts).toBeNull();
        cursor = next.json.data.nextCursor;
      } while (cursor);
      expect([sort, seen]).toEqual([sort, order]);
    }
    expect((await page(m, "?sort=size&cursor=abcdefghjkmn.Trip")).status).toBe(400);
    // Numbers past what the column holds are unknown cursors too, not a failed query.
    expect((await page(m, "?sort=date&cursor=abcdefghjkmn.99999999999999999999")).status).toBe(400);
    expect((await page(m, "?sort=size&cursor=abcdefghjkmn.99999999999999999999")).status).toBe(400);
  });

  it("filters by type, name, tags and date, and never lists folders", async () => {
    const { m } = await account();
    expect(names(await page(m, "?kind=image"))).toEqual(["a.jpg"]);
    expect(names(await page(m, `?q=${encodeURIComponent("#trip")}`))).toEqual(["c.mp4"]);
    expect(names(await page(m, "?q=B.TX"))).toEqual(["b.txt"]);
    expect(names(await page(m, `?q=${encodeURIComponent("type:folder")}`))).toEqual([]);
    expect(names(await page(m, `?q=${encodeURIComponent("type:video")}&kind=image`))).toEqual([]);
    expect(names(await page(m, `?q=${encodeURIComponent("trip")}`))).toEqual([]);
    // "#" with no tag yet lists nothing, as the File Manager's tag mode does.
    const hash = await page(m, `?q=${encodeURIComponent("#")}`);
    expect([names(hash), hash.json.data.counts?.all]).toEqual([[], 0]);
    // The chips count the search without their own type.
    expect((await page(m, "?kind=image&q=.")).json.data.counts).toEqual({ all: 3, video: 1, audio: 0, image: 1, other: 1 });
  });

  it("shows only the account's own present files, in a fixed number of queries", async () => {
    const { m, b, trip } = await account();
    const other = await account();
    await prisma.node.update({ where: { id: b }, data: { missing: true } });
    expect(names(await page(m))).toEqual(["c.mp4", "a.jpg"]);
    expect(names(await page(other.m))).toEqual(["c.mp4", "b.txt", "a.jpg"]);
    // A replaced file's earlier version, stepped aside under a "/" name, is not a file of its own.
    await addFile(m, m.rootId, [], "x", "x", "text/plain");
    await prisma.node.updateMany({ where: { accountId: m.id, name: "x" }, data: { name: "versions/abc" } });
    expect(names(await page(m))).toEqual(["c.mp4", "a.jpg"]);

    const small = await measure(() => page(m, "?limit=2"));
    for (let index = 0; index < 20; index++) await addFile(m, trip, ["Trip"], `more-${index}.txt`, "m", "text/plain");
    const large = await measure(() => page(m, "?limit=20"));
    expect(large.queries).toBe(small.queries);
  });
});

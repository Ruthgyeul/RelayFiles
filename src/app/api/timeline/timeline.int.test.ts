import { afterAll, describe, expect, it } from "vitest";
import type { TimelinePage } from "@/contracts/timeline";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { GET as timeline } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const page = (m: FixtureMember, query = "") => callRoute<TimelinePage>(timeline, { cookie: m.cookie, query });

describe("photos timeline", () => {
  it("lists photos and videos by the date taken, else the file date, newest first, page by page", async () => {
    const m = await member();
    const photo = (name: string, data: Record<string, unknown>, kind: "IMAGE" | "VIDEO" = "IMAGE") =>
      addFile(m, m.rootId, [], name, name, kind === "IMAGE" ? "image/jpeg" : "video/mp4", kind).then(async (id) => {
        await prisma.node.update({ where: { id }, data });
        return id;
      });
    const taken = await photo("taken.jpg", { takenAt: new Date("2026-08-01T10:00:00Z"), modifiedAt: new Date("2026-11-01T10:00:00Z") });
    const modified = await photo("modified.jpg", { modifiedAt: new Date("2026-09-01T10:00:00Z") });
    const clip = await photo("clip.mp4", { takenAt: new Date("2026-10-01T10:00:00Z") }, "VIDEO");
    // Left out: missing on the disk, a visitor upload not yet found clean, a replaced row, not media.
    await photo("missing.jpg", { missing: true });
    await photo("scanning.jpg", { scanState: "PENDING" });
    await photo("aside.jpg", { name: "aside/old.jpg" });
    await addFile(m, m.rootId, [], "notes.txt", "text", "text/plain", "OTHER");
    // Another account's photo never appears.
    const other = await member();
    await addFile(other, other.rootId, [], "theirs.jpg", "theirs", "image/jpeg", "IMAGE");

    const all = await page(m);
    expect(all.status).toBe(200);
    expect(all.json.data.items.map((item) => [item.id, item.dated, item.kind, item.parentIsRoot])).toEqual([
      [clip, true, "video", true],
      [modified, false, "image", true],
      [taken, true, "image", true],
    ]);
    expect(all.json.data.items[0]?.date).toBe("2026-10-01T10:00:00.000Z");
    expect(all.json.data.nextCursor).toBeNull();

    // Two at a time: the cursor continues after the last item, without repeats.
    const first = await page(m, "?limit=2");
    expect(first.json.data.items.map((item) => item.id)).toEqual([clip, modified]);
    const second = await page(m, `?limit=2&cursor=${first.json.data.nextCursor}`);
    expect(second.json.data.items.map((item) => item.id)).toEqual([taken]);
    expect(second.json.data.nextCursor).toBeNull();

    expect((await page(m, "?cursor=nonsense")).status).toBe(400);
    expect((await page(m, "?limit=100000")).status).toBe(400);
  });
});

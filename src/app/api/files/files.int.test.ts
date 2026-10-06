import { afterAll, describe, expect, it } from "vitest";
import { GET as download } from "@/app/api/files/[id]/download/route";
import { GET as stream } from "@/app/api/files/[id]/stream/route";
import { GET as zip } from "@/app/api/zip/route";
import { newLinkId, newNodeId } from "@/domain/ids";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { NextRequest } from "next/server";
import { fileFixtures } from "../../../../test/file-fixtures";

const { prisma, member, addFile, get, cleanup } = fileFixtures(4);

afterAll(cleanup);

describe("owner downloads and streaming", () => {
  it("downloads the original bytes as an attachment with a validator", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "여행 노트.txt", "hello bytes", "text/plain");
    const res = await get(download, m, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''%EC%97%AC%ED%96%89");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("hello bytes");
    const etag = res.headers.get("etag")!;
    expect((await get(download, m, id, { "if-none-match": etag })).status).toBe(304);

    const traffic = await prisma.trafficDaily.findMany({ where: { accountId: m.id } });
    expect(traffic.reduce((sum, row) => sum + row.bytes, 0n)).toBe(11n);
  });

  it("streams media inline with ranges, other types as attachments", async () => {
    const m = await member();
    const video = await addFile(m, m.rootId, [], "clip.mp4", Buffer.alloc(1000, 7), "video/mp4", "VIDEO");
    const res = await get(stream, m, video, { range: "bytes=100-199" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toContain("inline;");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect((await get(stream, m, video, { range: "bytes=5000-" })).status).toBe(416);

    const page = await addFile(m, m.rootId, [], "page.html", "<script>alert(1)</script>", "text/html");
    const html = await get(stream, m, page);
    expect(html.headers.get("content-disposition")).toContain("attachment;");
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("hides other accounts' files", async () => {
    const a = await member();
    const b = await member();
    const id = await addFile(a, a.rootId, [], "secret.txt", "s", "text/plain");
    expect((await get(download, b, id)).status).toBe(404);
  });
});

describe("zip", () => {
  it("zips folders with their structure and files by name", async () => {
    const m = await member();
    const trip = newNodeId();
    await prisma.node.create({ data: { id: trip, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Trip", linkId: newLinkId() } });
    await addFile(m, trip, ["Trip"], "a.txt", "alpha", "text/plain");
    await prisma.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: trip, type: "FOLDER", name: "empty", linkId: newLinkId() } });
    const loose = await addFile(m, m.rootId, [], "b.txt", "bravo", "text/plain");

    const req = new NextRequest(`http://localhost/api/zip?ids=${trip},${loose}`, { headers: { cookie: `${SESSION_COOKIE}=${m.cookie}` } });
    const res = await zip(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''root%20%C2%B7%202%20items.zip");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 2).toString()).toBe("PK");
    // Store mode keeps names and contents readable inside the archive.
    for (const text of ["Trip/a.txt", "Trip/empty/", "b.txt", "alpha", "bravo"]) expect(body.includes(Buffer.from(text)), text).toBe(true);
  });
});

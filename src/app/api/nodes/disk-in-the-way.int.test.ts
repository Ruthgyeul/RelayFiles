import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createToken } from "@/app/api/me/api-tokens/route";
import { POST as uploadV1 } from "@/app/api/v1/files/route";
import type { CreatedApiToken } from "@/contracts/api-tokens";
import { newLinkId, newNodeId } from "@/domain/ids";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { PATCH as renameRoute } from "./[id]/route";
import { POST as transfer } from "./transfer/route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

const DISK_ONLY = "only on the disk";

/** A file on the volume that the database does not list (DB and disk out of step). */
async function strayFile(m: FixtureMember, segments: string[], name: string) {
  await mkdir(join(m.dir, ...segments), { recursive: true });
  await writeFile(join(m.dir, ...segments, name), DISK_ONLY);
}

const stillThere = (m: FixtureMember, segments: string[], name: string) => readFile(join(m.dir, ...segments, name), "utf8");

describe("a disk entry the database does not know", () => {
  it("is not replaced by a rename (409, both stay)", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "a.txt", "mine", "text/plain");
    await strayFile(m, [], "b.txt");
    const res = await callRoute(renameRoute, { method: "PATCH", cookie: m.cookie, params: { id }, body: { name: "b.txt" } });
    expect([res.status, res.json.code]).toEqual([409, "CONFLICT"]);
    expect(await stillThere(m, [], "b.txt")).toBe(DISK_ONLY);
    expect(await stillThere(m, [], "a.txt")).toBe("mine");
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).name).toBe("a.txt");
  });

  it("is not replaced by a move (409, nothing moved)", async () => {
    const m = await member();
    const id = await addFile(m, m.rootId, [], "a.txt", "mine", "text/plain");
    const folder = newNodeId();
    await prisma.node.create({ data: { id: folder, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Box", linkId: newLinkId() } });
    await strayFile(m, ["Box"], "a.txt");
    const res = await callRoute(transfer, { method: "POST", cookie: m.cookie, body: { ids: [id], targetId: folder, mode: "move" } });
    expect([res.status, res.json.code]).toEqual([409, "CONFLICT"]);
    expect(await stillThere(m, ["Box"], "a.txt")).toBe(DISK_ONLY);
    expect(await stillThere(m, [], "a.txt")).toBe("mine");
    expect((await prisma.node.findUniqueOrThrow({ where: { id } })).parentId).toBe(m.rootId);
  });

  it("is not replaced by an upload (409, no row added)", async () => {
    const m = await member();
    await strayFile(m, [], "new.txt");
    const token = (await callRoute<CreatedApiToken>(createToken, { method: "POST", cookie: m.cookie, body: { name: "t", scopes: ["files:write"], expiresInDays: null } })).json.data.token;
    const body = Buffer.from("uploaded");
    const req = new NextRequest("http://localhost/api/v1/files?name=new.txt", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-length": String(body.length) },
      body: new Uint8Array(body),
    });
    const res = await uploadV1(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(409);
    expect(await stillThere(m, [], "new.txt")).toBe(DISK_ONLY);
    expect(await prisma.node.count({ where: { accountId: m.id, name: "new.txt" } })).toBe(0);
  });
});

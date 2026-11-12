import { Readable } from "node:stream";
import { extract } from "tar-stream";
import { afterAll, describe, expect, it } from "vitest";
import { AUTH, MS } from "@/config/policy";
import { exportManifestSchema, type ExportManifest } from "@/contracts/account-export";
import { EXPORT_MANIFEST_PATH } from "@/domain/account-export";
import { newLinkId, newNodeId } from "@/domain/ids";
import { findAccountById } from "@/server/repositories/account.repo";
import { applyExportManifest } from "@/server/services/import-metadata.service";
import { importFile, openImportTarget } from "@/server/services/import.service";
import { callRoute, callRouteRaw } from "../../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../../test/file-fixtures";
import { GET as exportAccount, POST as checkExport } from "./route";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

/** Every entry of a tar: name → bytes (folders: empty). */
async function readTar(body: ReadableStream<Uint8Array>): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  for await (const entry of Readable.fromWeb(body as import("node:stream/web").ReadableStream).pipe(extract())) {
    const chunks: Buffer[] = [];
    for await (const chunk of entry as AsyncIterable<Buffer>) chunks.push(chunk);
    entries.set(entry.header.name, Buffer.concat(chunks));
  }
  return entries;
}

/** Docs/ with a.txt (tags, note, a favorite in "Work / 2026"), b.txt (public, password) and gone.txt (not on disk). */
async function tree(m: FixtureMember) {
  const docs = newNodeId();
  await prisma.node.create({ data: { id: docs, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Docs", linkId: newLinkId(), tags: ["work"] } });
  const a = await addFile(m, docs, ["Docs"], "a.txt", "alpha", "text/plain");
  await prisma.node.update({ where: { id: a }, data: { tags: ["draft", "q4"], note: "Read me first" } });
  const b = await addFile(m, m.rootId, [], "b.txt", "bravo!", "text/plain");
  await prisma.node.update({ where: { id: b }, data: { visibility: "PUBLIC", passwordHash: "argon2-hash", downloadLimit: 3 } });
  await prisma.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: m.rootId, type: "FILE", kind: "OTHER", mime: "text/plain", name: "gone.txt", size: 4n, linkId: newLinkId() } });
  const work = newNodeId();
  const year = newNodeId();
  await prisma.favoriteFolder.create({ data: { id: work, accountId: m.id, parentId: null, name: "Work" } });
  await prisma.favoriteFolder.create({ data: { id: year, accountId: m.id, parentId: work, name: "2026" } });
  await prisma.favorite.create({ data: { id: newNodeId(), accountId: m.id, nodeId: a, folderId: year } });
  await prisma.favorite.create({ data: { id: newNodeId(), accountId: m.id, nodeId: b, folderId: null } });
}

describe("account export", () => {
  it("streams every file with a manifest that holds settings but no links or passwords", async () => {
    const m = await member();
    await tree(m);
    expect((await callRoute(checkExport, { method: "POST", cookie: m.cookie })).status).toBe(200);
    const res = await callRouteRaw(exportAccount, { cookie: m.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    expect(res.headers.get("content-disposition")).toMatch(/relayfiles-anon-[a-z0-9]+-\d{8}\.tar/);

    const entries = await readTar(res.body!);
    expect([...entries.keys()]).toEqual(["Docs/", "Docs/a.txt", "b.txt", EXPORT_MANIFEST_PATH]);
    expect(entries.get("Docs/a.txt")?.toString()).toBe("alpha");
    expect(entries.get("b.txt")?.toString()).toBe("bravo!");

    const text = entries.get(EXPORT_MANIFEST_PATH)!.toString();
    expect(text).not.toContain("argon2-hash");
    expect(text).not.toMatch(/linkId|passwordHash/);
    const manifest = exportManifestSchema.parse(JSON.parse(text));
    expect(manifest.items.find((item) => item.path === "Docs/a.txt")).toMatchObject({ tags: ["draft", "q4"], note: "Read me first", type: "file" });
    expect(manifest.items.find((item) => item.path === "b.txt")).toMatchObject({ visibility: "public", downloadLimit: 3 });
    expect(manifest.favoriteFolders).toEqual([["Work"], ["Work", "2026"]]);
    expect(manifest.favorites).toEqual(
      expect.arrayContaining([
        { path: "Docs/a.txt", folder: ["Work", "2026"] },
        { path: "b.txt", folder: [] },
      ]),
    );
    expect(manifest.skipped).toEqual([{ path: "gone.txt", reason: "not on disk" }]);

    expect(await prisma.accountEvent.count({ where: { accountId: m.id, kind: "account.exported" } })).toBe(1);
  });

  it("starts once per few minutes and needs a recent sign-in", async () => {
    const m = await member();
    expect((await callRouteRaw(exportAccount, { cookie: m.cookie })).status).toBe(200);
    const again = await callRoute(exportAccount, { cookie: m.cookie });
    expect([again.status, again.json.code]).toEqual([429, "RATE_LIMITED"]);
    expect((await callRoute(checkExport, { method: "POST", cookie: m.cookie })).status).toBe(429);

    const older = await member();
    await prisma.session.updateMany({ where: { accountId: older.id }, data: { createdAt: new Date(Date.now() - (AUTH.reauthWindowMin + 1) * MS.minute) } });
    const asked = await callRoute(checkExport, { method: "POST", cookie: older.cookie });
    expect([asked.status, asked.json.code]).toEqual([403, "REAUTH_REQUIRED"]);
    expect((await callRoute(exportAccount, { cookie: older.cookie })).json.code).toBe("REAUTH_REQUIRED");
  });

  it("imports back into the same tree with tags, notes and favorites", async () => {
    const source = await member();
    await tree(source);
    const entries = await readTar((await callRouteRaw(exportAccount, { cookie: source.cookie })).body!);
    const manifest: ExportManifest = exportManifestSchema.parse(JSON.parse(entries.get(EXPORT_MANIFEST_PATH)!.toString()));

    const into = await member();
    const account = (await findAccountById(prisma, into.id))!;
    const target = await openImportTarget(account, false);
    for (const [name, bytes] of entries) {
      if (name.endsWith("/") || name === EXPORT_MANIFEST_PATH) continue;
      expect((await importFile(target, `Restored/${name}`, bytes.length, Readable.from([bytes]))).status).toBe("imported");
    }
    const applied = await applyExportManifest(into, ["Restored"], manifest);
    // gone.txt was not in the tar.
    expect(applied).toEqual({ updated: 2, favorites: 2, notFound: 1 });

    const restored = await prisma.node.findFirstOrThrow({ where: { accountId: into.id, name: "a.txt" } });
    expect(restored.tags).toEqual(["draft", "q4"]);
    expect(restored.note).toBe("Read me first");
    // Share settings are not carried over: imported items stay private.
    expect((await prisma.node.findFirstOrThrow({ where: { accountId: into.id, name: "b.txt" } })).visibility).toBe("INHERIT");
    const favorite = await prisma.favorite.findFirstOrThrow({ where: { nodeId: restored.id }, include: { folder: true } });
    expect(favorite.folder?.name).toBe("2026");
    // A second run finds the folders and favorites already there.
    expect(await applyExportManifest(into, ["Restored"], manifest)).toEqual({ updated: 2, favorites: 0, notFound: 1 });
  });
});

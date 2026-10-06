import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { GET as getFolder } from "@/app/api/folders/[id]/route";
import { POST as createFolder } from "@/app/api/folders/route";
import { GET as search } from "@/app/api/search/route";
import type { CreatedAccount } from "@/contracts/auth";
import type { CreatedFolder, FolderView, TaggedItem } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { userRootOf } from "@/server/storage/safe-path";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { randomTestIp } from "../../../../test/file-fixtures";
import { callRoute } from "../../../../test/route-call";

const prisma = db();
const accounts: string[] = [];
const ip = randomTestIp();

async function newAccount() {
  const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip });
  accounts.push(res.json.data.account.id);
  return { id: res.json.data.account.id, cookie: res.cookie! };
}

const view = (cookie: string, id = "root") => callRoute<FolderView, { id: string }>(getFolder, { cookie, params: { id } });
const mkdir = (cookie: string, parentId: string, name: string) => callRoute<CreatedFolder>(createFolder, { method: "POST", cookie, body: { parentId, name } });

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

describe("folders", () => {
  it("lists an empty root", async () => {
    const { cookie } = await newAccount();
    const res = await view(cookie);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ isRoot: true, effectiveVisibility: "private", children: [] });
    expect(res.json.data.path).toHaveLength(1);
  });

  it("creates folders on disk, renames duplicates and nests them", async () => {
    const { id, cookie } = await newAccount();
    const first = await mkdir(cookie, "root", " Videos ");
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({ renamed: false, folder: { name: "Videos", type: "folder", itemCount: 0, size: "0" } });
    const second = await mkdir(cookie, "root", "Videos");
    expect(second.json.data).toMatchObject({ renamed: true, folder: { name: "Videos (2)" } });

    const videos = first.json.data.folder.id;
    const nested = await mkdir(cookie, videos, "2024");
    await access(join(userRootOf(configuredVolumeRoot(), id), "Videos", "2024"));

    const root = await view(cookie);
    expect(root.json.data.children.map((c) => c.name).sort()).toEqual(["Videos", "Videos (2)"]);
    expect(root.json.data.children.find((c) => c.id === videos)?.itemCount).toBe(1);

    const inner = await view(cookie, nested.json.data.folder.id);
    expect(inner.json.data.path.map((c) => c.name)).toEqual(["root", "Videos", "2024"]);
    expect(inner.json.data.isRoot).toBe(false);
  });

  it("rejects invalid names and other accounts' folders", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const bad = await mkdir(a.cookie, "root", "a/b");
    expect(bad.status).toBe(400);
    expect(bad.json.fields?.name).toBe('Name can\'t contain "/".');

    const folder = (await mkdir(a.cookie, "root", "Private")).json.data.folder.id;
    expect((await view(b.cookie, folder)).status).toBe(404);
    expect((await mkdir(b.cookie, folder, "x")).status).toBe(404);
    expect((await view(a.cookie, "../../etc")).status).toBe(400);
  });

  it("computes folder sizes, inherited visibility and tag searches", async () => {
    const { id, cookie } = await newAccount();
    const music = (await mkdir(cookie, "root", "Music")).json.data.folder.id;
    await prisma.node.update({ where: { id: music }, data: { visibility: "PUBLIC" } });
    const album = (await mkdir(cookie, music, "Album")).json.data.folder.id;
    // File rows are created by uploads (M7); insert them directly here.
    await prisma.node.createMany({
      data: [
        { id: newNodeId(), accountId: id, parentId: album, type: "FILE", kind: "AUDIO", name: "a.mp3", size: 3_000n, linkId: newLinkId(), tags: ["live", "2024"] },
        { id: newNodeId(), accountId: id, parentId: music, type: "FILE", kind: "AUDIO", name: "b.mp3", size: 500n, linkId: newLinkId(), tags: ["live"] },
      ],
    });

    const root = await view(cookie);
    expect(root.json.data.children[0]).toMatchObject({ name: "Music", size: "3500", itemCount: 2 });
    const inner = await view(cookie, album);
    expect(inner.json.data.effectiveVisibility).toBe("public");

    const both = await callRoute<TaggedItem[]>(search, { cookie, query: "?tags=live,2024" });
    expect(both.json.data.map((item) => [item.name, item.parentPath])).toEqual([["a.mp3", "root / Music / Album"]]);
    const live = await callRoute<TaggedItem[]>(search, { cookie, query: "?tags=LIVE" });
    expect(live.json.data).toHaveLength(2);
    expect((await callRoute(search, { cookie, query: "?tags=" })).status).toBe(400);
  });

  it("searches names, tags and recent files across the account", async () => {
    const { id, cookie } = await newAccount();
    const trips = (await mkdir(cookie, "root", "Trips")).json.data.folder.id;
    const now = Date.now();
    await prisma.node.createMany({
      data: [
        { id: newNodeId(), accountId: id, parentId: trips, type: "FILE", kind: "VIDEO", name: "My trip.mp4", size: 10n, linkId: newLinkId(), tags: ["2024"], createdAt: new Date(now - 2_000) },
        { id: newNodeId(), accountId: id, parentId: trips, type: "FILE", kind: "OTHER", name: "trip notes.txt", size: 5n, linkId: newLinkId(), createdAt: new Date(now - 1_000) },
      ],
    });
    const other = await newAccount();
    await mkdir(other.cookie, "root", "Trip ideas");

    const byName = (await callRoute<TaggedItem[]>(search, { cookie, query: "?q=TRIP" })).json.data;
    expect(byName.map((item) => [item.name, item.parentPath])).toEqual([
      ["Trips", "root"],
      ["trip notes.txt", "root / Trips"],
      ["My trip.mp4", "root / Trips"],
    ]);
    expect(byName[0]).toMatchObject({ parentIsRoot: true, itemCount: 2 });
    expect(byName[1]).toMatchObject({ parentId: trips, parentIsRoot: false });

    const tagged = (await callRoute<TaggedItem[]>(search, { cookie, query: "?q=%232024" })).json.data;
    expect(tagged.map((item) => item.name)).toEqual(["My trip.mp4"]);
    const recent = (await callRoute<TaggedItem[]>(search, { cookie, query: "?q=" })).json.data;
    expect(recent.map((item) => item.name)).toEqual(["trip notes.txt", "My trip.mp4"]);
    expect((await callRoute(search, { cookie, query: `?q=${"x".repeat(201)}` })).status).toBe(400);
  });
});

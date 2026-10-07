import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET as download } from "@/app/api/files/[id]/download/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as createFolder } from "@/app/api/folders/route";
import type { SessionState } from "@/contracts/auth";
import { db } from "@/server/db/client";
import { layoutOf } from "@/server/storage/layout";
import type { LayoutMigration } from "@/server/storage/layout-migrations";
import { userRootOf } from "@/server/storage/safe-path";
import { initVolume, readVolumeMarker } from "@/server/storage/volume";
import { migrateVolumeLayout, moveAccountToVolume } from "@/server/services/storage-migration.service";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures } from "../../../../test/file-fixtures";

const { prisma, member, addFile, get, cleanup } = fileFixtures();
const volumes: { id: string; root: string }[] = [];

/** A second volume in a temporary directory, registered like `npm run volume:init`. */
async function extraVolume(status: "ACTIVE" | "DRAINING") {
  const root = await mkdtemp(join(tmpdir(), "relay-volume-"));
  const id = randomUUID();
  await initVolume(root, id);
  await prisma.storageVolume.create({ data: { id, mountPath: root, status } });
  volumes.push({ id, root });
  return { id, root };
}

afterAll(async () => {
  // Accounts first (they reference the volumes), then the volumes and their directories.
  await cleanup();
  for (const volume of volumes) {
    await db().account.deleteMany({ where: { volumeId: volume.id } });
    await db().storageVolume.delete({ where: { id: volume.id } });
    await rm(volume.root, { recursive: true, force: true });
  }
});

describe("moving an account to another volume", () => {
  it("copies, verifies and switches without changing links, then trashes the old copy", async () => {
    const m = await member();
    const before = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    const sourceRoot = (await prisma.storageVolume.findUniqueOrThrow({ where: { id: before.volumeId } })).mountPath;
    const folder = (await callRoute<{ folder: { id: string } }>(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: "root", name: "Trip" } })).json.data.folder.id;
    const file = await addFile(m, folder, ["Trip"], "notes.txt", "see you there", "text/plain");
    const linkBefore = (await prisma.node.findUniqueOrThrow({ where: { id: file } })).linkId;
    const modeBefore = (await stat(join(userRootOf(sourceRoot, m.id), "Trip", "notes.txt"))).mode;

    const target = await extraVolume("ACTIVE");
    const report = await moveAccountToVolume(m.id, target.id);
    expect(report).toMatchObject({ accountId: m.id, from: before.volumeId, to: target.id, files: 1 });

    const after = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ volumeId: target.id, migrating: false });
    expect(await readFile(join(userRootOf(target.root, m.id), "Trip", "notes.txt"), "utf8")).toBe("see you there");
    expect((await stat(join(userRootOf(target.root, m.id), "Trip", "notes.txt"))).mode).toBe(modeBefore);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: file } })).linkId).toBe(linkBefore);
    const res = await get(download, m, file);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("see you there");

    // The old copy waits in the source volume's trash.
    await expect(stat(userRootOf(sourceRoot, m.id))).rejects.toThrow();
    expect((await readdir(layoutOf(sourceRoot).trash)).some((name) => name.includes(m.id))).toBe(true);
    for (const name of (await readdir(layoutOf(sourceRoot).trash)).filter((entry) => entry.includes(m.id))) await rm(join(layoutOf(sourceRoot).trash, name), { recursive: true, force: true });
    expect(await moveAccountToVolume(m.id, target.id)).toBeNull();
  });

  it("refuses changes while an account is moving and keeps reads", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    await prisma.account.update({ where: { id: m.id }, data: { migrating: true } });
    // The app shows the "moved to new storage" banner from the session state.
    expect((await callRoute<SessionState>(session, { cookie: m.cookie })).json.data.usage).toMatchObject({ storageBusy: true });
    const blocked = await callRoute(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: "root", name: "New" } });
    expect(blocked.status).toBe(503);
    expect(blocked.json.code).toBe("STORAGE_BUSY");
    expect((await get(download, m, file)).status).toBe(200);
    await prisma.account.update({ where: { id: m.id }, data: { migrating: false } });
  });
});

describe("storage layout migrations", () => {
  it("applies steps in order, journals them and resumes after an interruption", async () => {
    const volume = await extraVolume("DRAINING");
    let failOnce = true;
    const steps: LayoutMigration[] = [
      {
        from: 1,
        to: 2,
        description: "move system/thumbs to system/previews",
        async up(root) {
          const from = join(root, "system", "thumbs");
          if (await stat(from).then(() => true, () => false)) await rename(from, join(root, "system", "previews"));
        },
      },
      {
        from: 2,
        to: 3,
        description: "add system/cache",
        async up(root) {
          if (failOnce) {
            failOnce = false;
            throw new Error("power cut");
          }
          await mkdir(join(root, "system", "cache"), { recursive: true });
        },
      },
    ];

    await expect(migrateVolumeLayout(volume.id, undefined, steps, 3)).rejects.toThrow("power cut");
    expect((await readVolumeMarker(volume.root))?.layoutVersion).toBe(2);
    expect((await prisma.storageVolume.findUniqueOrThrow({ where: { id: volume.id } })).status).toBe("READONLY");

    expect(await migrateVolumeLayout(volume.id, undefined, steps, 3)).toEqual({ from: 2, to: 3 });
    expect((await readVolumeMarker(volume.root))?.layoutVersion).toBe(3);
    await stat(join(volume.root, "system", "previews"));
    await stat(join(volume.root, "system", "cache"));
    const row = await prisma.storageVolume.findUniqueOrThrow({ where: { id: volume.id } });
    expect(row).toMatchObject({ layoutVersion: 3 });
    const journal = (await readFile(join(volume.root, "system", "migration.journal"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { step: string; state: string });
    expect(journal.map((entry) => `${entry.step}:${entry.state}`)).toEqual(["1->2:started", "1->2:done", "2->3:started", "2->3:started", "2->3:done"]);
    expect(await migrateVolumeLayout(volume.id, undefined, steps, 3)).toEqual({ from: 3, to: 3 });
  });
});

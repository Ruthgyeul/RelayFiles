import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { watchVolumes } from "@/server/jobs/volume-watch";
import { layoutOf } from "@/server/storage/layout";
import { initVolume } from "@/server/storage/volume";
import { fileFixtures } from "../../../test/file-fixtures";
import { runFsck } from "./fsck.service";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(cleanup);

describe("storage:fsck", () => {
  it("reports differences without changing anything, then repairs them with --fix", async () => {
    const m = await member();
    const kept = await addFile(m, m.rootId, [], "kept.txt", "kept", "text/plain");
    const gone = await addFile(m, m.rootId, [], "gone.txt", "gone", "text/plain");
    await addFile(m, m.rootId, [], "grown.txt", "small", "text/plain");
    await rm(join(m.dir, "gone.txt"));
    await writeFile(join(m.dir, "grown.txt"), "much larger now");
    await mkdir(join(m.dir, "Leftover", "Deep"), { recursive: true });
    await writeFile(join(m.dir, "Leftover", "Deep", "x.bin"), "x");
    await symlink("/etc/hostname", join(m.dir, "link"));

    const dry = await runFsck({ fix: false, accountId: m.id });
    expect(dry.accounts).toMatchObject([{ accountId: m.id, missing: ["gone.txt"], orphans: ["Leftover", "link"], sizeMismatch: ["grown.txt"], trashed: 0, flagged: 0 }]);
    expect((await readdir(m.dir)).sort()).toEqual(["Leftover", "grown.txt", "kept.txt", "link"]);

    const fixed = await runFsck({ fix: true, accountId: m.id });
    expect(fixed.accounts[0]).toMatchObject({ trashed: 1, flagged: 1, notMoved: ["link"] });
    expect((await readdir(m.dir)).sort()).toEqual(["grown.txt", "kept.txt", "link"]);
    const flags = await prisma.node.findMany({ where: { id: { in: [kept, gone] } }, select: { id: true, missing: true } });
    expect(Object.fromEntries(flags.map((row) => [row.id, row.missing]))).toEqual({ [kept]: false, [gone]: true });

    // The file is back: its flag is cleared on the next repair.
    await writeFile(join(m.dir, "gone.txt"), "gone");
    await rm(join(m.dir, "link"));
    await runFsck({ fix: true, accountId: m.id });
    expect((await prisma.node.findUniqueOrThrow({ where: { id: gone } })).missing).toBe(false);
  });
});

describe("volume watch", () => {
  it("takes a volume offline when its marker disappears and back when it returns", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-watch-"));
    const id = randomUUID();
    try {
      await initVolume(root, id);
      await prisma.storageVolume.create({ data: { id, mountPath: root, status: "ACTIVE" } });
      const status = async () => (await prisma.storageVolume.findUniqueOrThrow({ where: { id } })).status;
      expect((await watchVolumes()).filter((change) => change.volumeId === id)).toEqual([]);

      const marker = layoutOf(root).marker;
      await rename(marker, `${marker}.away`);
      expect((await watchVolumes()).filter((change) => change.volumeId === id)).toEqual([{ volumeId: id, status: "OFFLINE" }]);
      expect(await status()).toBe("OFFLINE");

      await rename(`${marker}.away`, marker);
      await watchVolumes();
      expect(await status()).toBe("ACTIVE");

      // A volume being migrated is left alone.
      await prisma.storageVolume.update({ where: { id }, data: { status: "READONLY" } });
      await rename(marker, `${marker}.away`);
      await watchVolumes();
      expect(await status()).toBe("READONLY");
    } finally {
      await prisma.storageVolume.deleteMany({ where: { id } });
      await rm(root, { recursive: true, force: true });
    }
  });
});

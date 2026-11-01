import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as createFolder } from "@/app/api/folders/route";
import { PATCH as rename } from "@/app/api/nodes/[id]/route";
import { POST as remove } from "@/app/api/nodes/delete/route";
import { POST as transfer } from "@/app/api/nodes/transfer/route";
import type { CreatedFolder, TransferResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { runDataMigrations, type DataMigrationStep } from "@/server/migrations/data-migrations";
import { layoutOf } from "@/server/storage/layout";
import { LocalVolumeDriver } from "@/server/storage/local-volume";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, type FixtureMember } from "../../../../test/file-fixtures";
import { runFsck } from "@/server/services/fsck.service";
import { lockedLocationOf } from "@/server/services/node-location";
import { endMaintenanceHold, startAccountMove, startMaintenanceHold } from "@/server/services/volume.service";

const { prisma, member, addFile, cleanup } = fileFixtures();
const migrationIds: string[] = [];

afterAll(async () => {
  await prisma.dataMigration.deleteMany({ where: { id: { in: migrationIds } } });
  await cleanup();
});

/** A promise and the function that settles it: a step of the test lets a paused operation go on. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Waits until some connection waits for a lock (a row or advisory lock held by an open transaction). */
async function someoneWaitsForALock(): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("nothing waited for a lock");
}

/** Pauses one call of a driver method: before it runs (`before`) or after it ran (`after`). */
function pauseDriver(method: "stageCopy" | "moveIntoPlace", when: "before" | "after") {
  const reached = gate();
  const release = gate();
  const original = LocalVolumeDriver.prototype[method] as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(LocalVolumeDriver.prototype, method).mockImplementationOnce(async function (this: LocalVolumeDriver, ...args: unknown[]) {
    if (when === "before") {
      reached.open();
      await release.opened;
      return original.apply(this, args);
    }
    const result = await original.apply(this, args);
    reached.open();
    await release.opened;
    return result;
  } as never);
  return { reached: reached.opened, release: release.open };
}

const volumeOf = async (m: FixtureMember) => (await prisma.account.findUniqueOrThrow({ where: { id: m.id }, select: { volumeId: true } })).volumeId;
const copy = (m: FixtureMember, ids: string[], targetId = "root") => callRoute<TransferResult>(transfer, { method: "POST", cookie: m.cookie, body: { ids, targetId, mode: "copy" } });
const folder = async (m: FixtureMember, name: string) => (await callRoute<CreatedFolder>(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: "root", name } })).json.data.folder.id;

describe("writes and volume moves", () => {
  it("refuses a copy whose transaction comes after a volume move started", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    const paused = pauseDriver("stageCopy", "before");
    const copying = copy(m, [file]);
    await paused.reached;
    // The move starts while the copy is still staging its bytes (outside any transaction).
    await startAccountMove(m.id);
    paused.release();
    const res = await copying;
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("STORAGE_BUSY");
    // Nothing landed on the volume the account is leaving.
    expect(await readdir(m.dir)).toEqual(["a.txt"]);
    expect(await prisma.node.count({ where: { accountId: m.id, type: "FILE" } })).toBe(1);
    await prisma.account.update({ where: { id: m.id }, data: { migrating: false } });
  });

  it("starts a volume move only after the account's running storage transactions end", async () => {
    const m = await member();
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    const paused = pauseDriver("moveIntoPlace", "after");
    const copying = copy(m, [file]);
    await paused.reached;
    let started = false;
    const moving = startAccountMove(m.id).then(() => (started = true));
    await someoneWaitsForALock();
    expect(started).toBe(false);
    paused.release();
    expect((await copying).status).toBe(200);
    await moving;
    // The copy committed before the account was marked, so the move's hash sees it.
    expect((await readdir(m.dir)).sort()).toEqual(["a (2).txt", "a.txt"]);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: m.id } })).migrating).toBe(true);
    await prisma.account.update({ where: { id: m.id }, data: { migrating: false } });
  });
});

describe("maintenance holds", () => {
  it("makes a volume READONLY only after its running writes end, then refuses changes", async () => {
    const m = await member();
    const volumeId = await volumeOf(m);
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    const paused = pauseDriver("moveIntoPlace", "after");
    const copying = copy(m, [file]);
    await paused.reached;
    let held = false;
    const holding = startMaintenanceHold(volumeId, "ACTIVE").then(() => (held = true));
    try {
      await someoneWaitsForALock();
      expect(held).toBe(false);
      paused.release();
      expect((await copying).status).toBe(200);
      await holding;
      expect(await prisma.storageVolume.findUniqueOrThrow({ where: { id: volumeId } })).toMatchObject({ status: "READONLY", resumeStatus: "ACTIVE" });
      const refused = await callRoute(createFolder, { method: "POST", cookie: m.cookie, body: { parentId: "root", name: "Later" } });
      expect(refused.json.code).toBe("STORAGE_BUSY");
    } finally {
      await holding.catch(() => undefined);
      await endMaintenanceHold(volumeId, "ACTIVE");
    }
    expect(await prisma.storageVolume.findUniqueOrThrow({ where: { id: volumeId } })).toMatchObject({ status: "ACTIVE", resumeStatus: null });
  });

  it("storage:fsck --fix waits for a write in flight instead of trashing its file", async () => {
    const m = await member();
    const volumeId = await volumeOf(m);
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    // The copy's file is in place on disk, its row not committed yet.
    const paused = pauseDriver("moveIntoPlace", "after");
    const copying = copy(m, [file]);
    await paused.reached;
    const fixing = runFsck({ fix: true, accountId: m.id });
    await someoneWaitsForALock();
    paused.release();
    expect((await copying).status).toBe(200);
    const report = await fixing;
    expect(report.accounts).toEqual([]);
    expect((await readdir(m.dir)).sort()).toEqual(["a (2).txt", "a.txt"]);
    expect(await prisma.storageVolume.findUniqueOrThrow({ where: { id: volumeId } })).toMatchObject({ status: "ACTIVE", resumeStatus: null });
  });

  it("storage:fsck --fix refuses a volume another maintenance run holds", async () => {
    const m = await member();
    const volumeId = await volumeOf(m);
    await prisma.storageVolume.update({ where: { id: volumeId }, data: { status: "READONLY", resumeStatus: "ACTIVE" } });
    try {
      await expect(runFsck({ fix: true, accountId: m.id })).rejects.toThrow(/held READONLY by another maintenance run/);
      // Reporting still works.
      expect((await runFsck({ fix: false, accountId: m.id })).accounts).toEqual([]);
    } finally {
      await prisma.storageVolume.update({ where: { id: volumeId }, data: { status: "ACTIVE", resumeStatus: null } });
    }
  });
});

describe("copying folders", () => {
  it("copies the database rows' files, not whatever else is in the folder on disk", async () => {
    const m = await member();
    const trip = await folder(m, "Trip");
    await addFile(m, trip, ["Trip"], "a.txt", "hello", "text/plain");
    await writeFile(join(m.dir, "Trip", "stray.txt"), "not in the database");
    const gone = await addFile(m, trip, ["Trip"], "gone.txt", "flagged", "text/plain");
    await rm(join(m.dir, "Trip", "gone.txt"));
    await prisma.node.update({ where: { id: gone }, data: { missing: true } });

    expect((await copy(m, [trip])).status).toBe(200);
    expect((await readdir(join(m.dir, "Trip (2)"))).sort()).toEqual(["a.txt"]);
    const copied = await prisma.node.findMany({ where: { accountId: m.id, parent: { name: "Trip (2)" } }, select: { name: true, missing: true }, orderBy: { name: "asc" } });
    expect(copied).toEqual([
      { name: "a.txt", missing: false },
      { name: "gone.txt", missing: true },
    ]);
  });

  it("stops with 409 and leaves nothing behind when a file of the rows is not on disk", async () => {
    const m = await member();
    const trip = await folder(m, "Trip");
    await addFile(m, trip, ["Trip"], "a.txt", "hello", "text/plain");
    await addFile(m, trip, ["Trip"], "b.txt", "world", "text/plain");
    await rm(join(m.dir, "Trip", "b.txt"));
    const before = await prisma.node.count({ where: { accountId: m.id } });

    const res = await copy(m, [trip]);
    expect(res.status).toBe(409);
    expect(await prisma.node.count({ where: { accountId: m.id } })).toBe(before);
    expect(await readdir(m.dir)).toEqual(["Trip"]);
    const uploads = layoutOf(join(m.dir, "..", "..")).uploads;
    expect((await readdir(uploads)).filter((name) => name.startsWith("copy-"))).toEqual([]);
  });
});

describe("name clashes and trash accounting", () => {
  it("answers 409 when a name in the target is taken while a move runs", async () => {
    const m = await member();
    const target = await folder(m, "Target");
    const file = await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    const done = gate();
    // Another request adds "a.txt" to the target and has not committed yet: the move does not see it.
    const other = prisma.$transaction(async (tx) => {
      await tx.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: target, type: "FILE", kind: "OTHER", name: "a.txt", size: 1n, linkId: newLinkId() } });
      await done.opened;
    });
    const moving = callRoute(transfer, { method: "POST", cookie: m.cookie, body: { ids: [file], targetId: target, mode: "move" } });
    await someoneWaitsForALock();
    done.open();
    await other;
    const res = await moving;
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("CONFLICT");
    // Nothing moved on disk either.
    await stat(join(m.dir, "a.txt"));
  });

  it("counts files added to a folder while it is being deleted", async () => {
    const m = await member();
    const trip = await folder(m, "Trip");
    await addFile(m, trip, ["Trip"], "a.bin", "x".repeat(5), "application/octet-stream");
    const done = gate();
    // An upload into the folder has written its row but not committed when the delete starts.
    const upload = prisma.$transaction(async (tx) => {
      await tx.node.create({ data: { id: newNodeId(), accountId: m.id, parentId: trip, type: "FILE", kind: "OTHER", name: "b.bin", size: 7n, linkId: newLinkId() } });
      await writeFile(join(m.dir, "Trip", "b.bin"), "y".repeat(7));
      await done.opened;
    });
    const deleting = callRoute(remove, { method: "POST", cookie: m.cookie, body: { ids: [trip] } });
    await someoneWaitsForALock();
    done.open();
    await upload;
    expect((await deleting).status).toBe(200);
    const trashed = await prisma.trashedBytes.aggregate({ where: { accountId: m.id }, _sum: { bytes: true } });
    expect(trashed._sum.bytes).toBe(12n);
  });
});

describe("deduplicated uploads", () => {
  it("locks the existing copy's folders so they cannot be renamed before the link is made", async () => {
    const m = await member();
    const photos = await folder(m, "Photos");
    await mkdir(join(m.dir, "Photos"), { recursive: true });
    const twin = await addFile(m, photos, ["Photos"], "a.jpg", "same bytes", "image/jpeg");
    const done = gate();
    let renamed = false;
    let renaming: Promise<unknown> | undefined;
    const located = prisma.$transaction(async (tx) => {
      const location = await lockedLocationOf(tx, m.id, twin);
      renaming = callRoute(rename, { method: "PATCH", cookie: m.cookie, params: { id: photos }, body: { name: "Pictures" } }).then((res) => {
        renamed = true;
        return res;
      });
      await someoneWaitsForALock();
      // The path stays valid until the transaction ends.
      expect(renamed).toBe(false);
      await stat(join(m.dir, ...location!.segments));
      await done.opened;
      return location;
    });
    done.open();
    expect((await located)?.segments).toEqual(["Photos", "a.jpg"]);
    expect(((await renaming) as { status: number }).status).toBe(200);
    expect(await lockedLocationOf(prisma, m.id, newNodeId())).toBeNull();
  });
});

describe("data migrations", () => {
  it("never run the same step twice when two runs start together", async () => {
    const id = `test-lock-${Date.now()}`;
    migrationIds.push(id);
    let running = 0;
    let most = 0;
    let runs = 0;
    const step: DataMigrationStep = {
      id,
      description: "counts how many runs process it at once",
      async run({ save }) {
        runs++;
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await save("done");
        running--;
      },
    };
    const reports = await Promise.all([runDataMigrations(prisma, [step]), runDataMigrations(prisma, [step])]);
    expect(runs).toBe(1);
    expect(most).toBe(1);
    expect(reports.map((report) => report.ran.length).sort()).toEqual([0, 1]);
  });
});

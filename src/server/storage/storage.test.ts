import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { LocalVolumeDriver } = await import("./local-volume");
const { UnsafePathError, resolveInsideUserRoot } = await import("./safe-path");
const { checkVolume, initVolume, readVolumeMarker } = await import("./volume");
const { withStorageTransaction } = await import("./storage-transaction");
const { layoutOf } = await import("./layout");

const ACCOUNT = "abcdefghjkmn";
const OTHER = "pqrstuvwxyz2";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-volume-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveInsideUserRoot", () => {
  it("maps folder names under users/<accountId>", () => {
    expect(resolveInsideUserRoot(root, ACCOUNT, ["Videos", "flower.mp4"])).toBe(join(root, "users", ACCOUNT, "Videos", "flower.mp4"));
    expect(resolveInsideUserRoot(root, ACCOUNT, [])).toBe(join(root, "users", ACCOUNT));
  });

  it.each([[[".."]], [["a", "..", "..", OTHER]], [["a/b"]], [["/etc"]], [["a\0b"]], [[""]], [[" lead"]]])("rejects %j", (segments) => {
    expect(() => resolveInsideUserRoot(root, ACCOUNT, segments)).toThrow(UnsafePathError);
  });

  it("rejects invalid account ids", () => {
    expect(() => resolveInsideUserRoot(root, "../x", ["a"])).toThrow(UnsafePathError);
  });

  it("limits folder depth", () => {
    expect(() => resolveInsideUserRoot(root, ACCOUNT, Array.from({ length: 33 }, (_, i) => `d${i}`))).toThrow(/too deep/);
  });
});

describe("volume marker", () => {
  it("initialises the layout with owner-only permissions and refuses to re-initialise", async () => {
    const marker = await initVolume(root, "vol-1");
    expect(await readVolumeMarker(root)).toEqual(marker);
    const layout = layoutOf(root);
    for (const dir of [layout.users, layout.uploads, layout.thumbs, layout.derived, layout.trash]) {
      expect(((await stat(dir)).mode & 0o777).toString(8)).toBe("700");
    }
    expect(((await stat(layout.marker)).mode & 0o777).toString(8)).toBe("600");
    await expect(initVolume(root, "vol-2")).rejects.toThrow(/already initialised/);
  });

  it("reports offline when the marker is missing (SSD not mounted)", async () => {
    expect((await checkVolume(root, "vol-1")).state).toBe("offline");
  });

  it("reports a different volume and a layout mismatch", async () => {
    await initVolume(root, "vol-1");
    expect((await checkVolume(root, "vol-1")).state).toBe("online");
    expect((await checkVolume(root, "vol-9")).state).toBe("mismatch");
    await writeFile(layoutOf(root).marker, JSON.stringify({ volumeId: "vol-1", layoutVersion: 99, createdAt: "x" }));
    expect((await checkVolume(root, "vol-1")).state).toBe("layout-mismatch");
  });
});

describe("LocalVolumeDriver", () => {
  const at = (...segments: string[]) => ({ accountId: ACCOUNT, segments });

  beforeEach(async () => {
    await initVolume(root, "vol-1");
  });

  it("stores uploads as original bytes under the account root with real names", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await driver.createFolder(at("한글 폴더"));
    const temp = join(layoutOf(root).uploads, "chunk-1");
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    await writeFile(temp, bytes);
    await driver.moveIntoPlace(temp, at("한글 폴더", "clip.mp4"));

    expect(await readFile(join(root, "users", ACCOUNT, "한글 폴더", "clip.mp4"))).toEqual(bytes);
    expect(await driver.stat(at("한글 폴더", "clip.mp4"))).toMatchObject({ type: "file", size: 6n });
    expect(await driver.stat(at("missing"))).toBeNull();
  });

  it("rejects uploads that do not come from the volume upload area", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await expect(driver.moveIntoPlace("/etc/passwd", at("x"))).rejects.toThrow(/upload area/);
  });

  it("renames and moves folders with their contents", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await driver.createFolder(at("A"));
    await writeFile(join(root, "users", ACCOUNT, "A", "f.txt"), "x");
    await driver.createFolder(at("B"));
    await driver.rename(at("A"), at("B", "A2"));
    expect(await readFile(join(root, "users", ACCOUNT, "B", "A2", "f.txt"), "utf8")).toBe("x");
  });

  it("copies files and folders without overwriting", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await writeFile(join(root, "users", ACCOUNT, "a.txt"), "hello");
    await driver.copy(at("a.txt"), at("b.txt"));
    expect(await readFile(join(root, "users", ACCOUNT, "b.txt"), "utf8")).toBe("hello");
    await expect(driver.copy(at("a.txt"), at("b.txt"))).rejects.toThrow();
  });

  it("copies by hard link, folders included, and links a re-upload to an existing file of the same size", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    const user = join(root, "users", ACCOUNT);
    await mkdir(join(user, "A", "B"), { recursive: true });
    await writeFile(join(user, "A", "B", "f.txt"), "same");
    await driver.copy(at("A"), at("A2"));
    expect((await stat(join(user, "A2", "B", "f.txt"))).ino).toBe((await stat(join(user, "A", "B", "f.txt"))).ino);

    expect(await driver.linkExisting(at("A", "B", "f.txt"), at("g.txt"), 4)).toBe(true);
    expect((await stat(join(user, "g.txt"))).nlink).toBe(3);
    expect(await driver.linkExisting(at("A", "B", "f.txt"), at("h.txt"), 5)).toBe(false);
    expect(await driver.linkExisting(at("gone.txt"), at("h.txt"), 4)).toBe(false);
  });

  it("refuses to copy a folder with a symbolic link inside", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await mkdir(join(root, "users", ACCOUNT, "A"));
    await symlink("/etc", join(root, "users", ACCOUNT, "A", "etc"));
    await expect(driver.copy(at("A"), at("A2"))).rejects.toThrow("Only files and folders can be copied.");
  });

  it("refuses to follow symbolic links planted inside an account", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await mkdir(join(root, "users", OTHER), { recursive: true });
    await writeFile(join(root, "users", OTHER, "secret.txt"), "private");
    await symlink(join(root, "users", OTHER), join(root, "users", ACCOUNT, "link"));
    await expect(driver.stat(at("link", "secret.txt"))).rejects.toThrow(UnsafePathError);
    await expect(driver.createReadStream(at("link", "secret.txt"))).rejects.toThrow(UnsafePathError);
  });

  it("serves generated files as ranged sources and refuses symbolic links", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    const asset = { kind: "derived", accountId: ACCOUNT, nodeId: "nodeaaaaaaaa" } as const;
    expect(await driver.assetSource(asset)).toBeNull();

    await driver.writeAsset(asset, Buffer.from("0123456789"));
    const source = (await driver.assetSource(asset))!;
    expect(source.size).toBe(10);
    expect((await buffer(await source.open({ start: 2, end: 5 }))).toString()).toBe("2345");
    expect((await buffer(await source.open())).toString()).toBe("0123456789");

    await writeFile(join(root, "secret.txt"), "private");
    const planted = { ...asset, nodeId: "nodebbbbbbbb" };
    await symlink(join(root, "secret.txt"), join(layoutOf(root).derived, ACCOUNT, "nodebbbbbbbb"));
    await expect(driver.assetSource(planted)).rejects.toThrow();
  });

  it("moves items to the trash area", async () => {
    const driver = new LocalVolumeDriver("vol-1", root);
    await driver.ensureUserRoot(ACCOUNT);
    await writeFile(join(root, "users", ACCOUNT, "old.txt"), "x");
    const trashed = await driver.moveToTrash(at("old.txt"));
    expect(trashed.startsWith(layoutOf(root).trash)).toBe(true);
    expect(await driver.stat(at("old.txt"))).toBeNull();

    await driver.restoreFromTrash(trashed, at("old.txt"));
    expect((await driver.stat(at("old.txt")))?.type).toBe("file");
    await expect(driver.restoreFromTrash(join(root, "users", ACCOUNT, "old.txt"), at("x.txt"))).rejects.toThrow(/trash/);
  });

  it("reports free space", async () => {
    const space = await new LocalVolumeDriver("vol-1", root).space();
    expect(space.total).toBeGreaterThan(0n);
    expect(space.available).toBeLessThanOrEqual(space.total);
  });
});

describe("withStorageTransaction", () => {
  const fakeDb = (commitFails: boolean) => ({
    async $transaction<R>(fn: (tx: string) => Promise<R>) {
      const result = await fn("tx");
      if (commitFails) throw new Error("commit failed");
      return result;
    },
  });

  it("returns the result and keeps filesystem changes on success", async () => {
    const undo = vi.fn(async () => undefined);
    const result = await withStorageTransaction(fakeDb(false), async (_tx, stack) => {
      stack.push("create", undo);
      return 42;
    });
    expect(result).toBe(42);
    expect(undo).not.toHaveBeenCalled();
  });

  it("runs undo steps newest first when the callback or commit fails", async () => {
    const order: string[] = [];
    await expect(
      withStorageTransaction(fakeDb(true), async (_tx, stack) => {
        stack.push("first", async () => void order.push("first"));
        stack.push("second", async () => void order.push("second"));
      }),
    ).rejects.toThrow("commit failed");
    expect(order).toEqual(["second", "first"]);
  });

  it("continues rolling back when one undo step fails", async () => {
    const later = vi.fn(async () => undefined);
    await expect(
      withStorageTransaction(fakeDb(false), async (_tx, stack) => {
        stack.push("ok", later);
        stack.push("broken", async () => {
          throw new Error("disk gone");
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(later).toHaveBeenCalled();
  });
});

import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layoutPlan, type LayoutMigration } from "./layout-migrations";
import { copyTree, hashTree, treeDifferences } from "./tree";
import { layoutOf } from "./layout";
import { initVolume, readVolumeMarker, writeVolumeMarker } from "./volume";

const step = (from: number, to: number): LayoutMigration => ({ from, to, description: `${from}->${to}`, up: async () => undefined });

describe("layoutPlan", () => {
  const steps = [step(1, 2), step(2, 3), step(3, 4)];

  it("returns the steps between two versions in order", () => {
    expect(layoutPlan(1, 4, steps).map((item) => item.description)).toEqual(["1->2", "2->3", "3->4"]);
    expect(layoutPlan(2, 3, steps).map((item) => item.description)).toEqual(["2->3"]);
  });

  it("is empty when the volume is current", () => {
    expect(layoutPlan(3, 3, steps)).toEqual([]);
    expect(layoutPlan(1, 1, [])).toEqual([]);
  });

  it("refuses a gap and a volume newer than the code", () => {
    expect(() => layoutPlan(1, 3, [step(2, 3)])).toThrow("No storage migration from layout 1");
    expect(() => layoutPlan(4, 3, steps)).toThrow("newer than this release");
  });
});

describe("tree helpers", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "relay-tree-"));
    await mkdir(join(root, "a", "Trip 여행"), { recursive: true });
    await writeFile(join(root, "a", "Trip 여행", "notes.txt"), "see you");
    await writeFile(join(root, "a", "top.bin"), Buffer.alloc(1024, 7));
    await chmod(join(root, "a", "top.bin"), 0o600);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("hashes every file and copies a tree with its modes", async () => {
    const original = await hashTree(join(root, "a"));
    expect([...original.keys()].sort()).toEqual([join("Trip 여행", "notes.txt"), "top.bin"]);
    expect(original.get("top.bin")?.size).toBe(1024);

    await copyTree(join(root, "a"), join(root, "b"));
    expect(treeDifferences(original, await hashTree(join(root, "b")))).toEqual([]);
    expect((await stat(join(root, "b", "top.bin"))).mode & 0o777).toBe(0o600);
    await expect(copyTree(join(root, "a"), join(root, "b"))).rejects.toThrow();
  });

  it("reports missing, different and unexpected files", async () => {
    const original = await hashTree(join(root, "a"));
    await copyTree(join(root, "a"), join(root, "b"));
    await rm(join(root, "b", "top.bin"));
    await writeFile(join(root, "b", "Trip 여행", "notes.txt"), "changed");
    await writeFile(join(root, "b", "extra.txt"), "x");
    expect(treeDifferences(original, await hashTree(join(root, "b"))).sort()).toEqual(
      [`different: ${join("Trip 여행", "notes.txt")}`, "missing: top.bin", "unexpected: extra.txt"].sort(),
    );
  });

  it("refuses symbolic links", async () => {
    await symlink("/etc/passwd", join(root, "a", "link"));
    await expect(hashTree(join(root, "a"))).rejects.toThrow("Symbolic link");
  });
});

describe("writeVolumeMarker", () => {
  it("replaces the marker atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-marker-"));
    try {
      const marker = await initVolume(root, "vol-1");
      await writeVolumeMarker(root, { ...marker, layoutVersion: 2 });
      expect(await readVolumeMarker(root)).toEqual({ ...marker, layoutVersion: 2 });
      expect(JSON.parse(await readFile(layoutOf(root).marker, "utf8")).layoutVersion).toBe(2);
      await expect(stat(`${layoutOf(root).marker}.tmp`)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

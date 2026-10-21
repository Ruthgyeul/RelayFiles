import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newAccountId, newLinkId, newNodeId } from "@/domain/ids";
import { db } from "../db/client";
import { closeQueues } from "../jobs/queue";
import { redis } from "../redis";
import { layoutOf, FILE_MODE } from "../storage/layout";
import { initVolume } from "../storage/volume";
import { importFile, openImportTarget } from "./import.service";

const prisma = db();
const volumeId = `test-${randomUUID()}`;
const accountId = newAccountId();
let root: string;

const source = (text: string) => (async function* () { yield Buffer.from(text); })();
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const owner = (quotaBytes: bigint | null = null) => ({ id: accountId, volumeId, quotaBytes });

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relayfiles-import-")));
  await initVolume(root, volumeId);
  await prisma.storageVolume.create({ data: { id: volumeId, mountPath: root, reservePct: 0 } });
  await prisma.account.create({
    data: {
      id: accountId,
      name: `anon-${accountId.slice(0, 6)}`,
      tokenLookup: `lookup-${accountId}`,
      tokenEnc: Buffer.from("enc"),
      color: "var(--accent)",
      volumeId,
      nodes: { create: { id: newNodeId(), type: "FOLDER", name: "root", linkId: newLinkId() } },
    },
  });
});

afterAll(async () => {
  await prisma.account.deleteMany({ where: { id: accountId } });
  await prisma.storageVolume.deleteMany({ where: { id: volumeId } });
  await rm(root, { recursive: true, force: true });
  await closeQueues();
  await prisma.$disconnect();
  redis().disconnect();
});

describe("importFile", () => {
  it("copies files into the account like uploads", async () => {
    const target = await openImportTarget(owner(), false);
    const a = await importFile(target, "a.txt", 5, source("hello"));
    const b = await importFile(target, "Docs/Sub/b.txt", 6, source("world!"));
    expect(a.status).toBe("imported");
    expect(b.status).toBe("imported");

    const files = await prisma.node.findMany({ where: { accountId, type: "FILE" }, orderBy: { name: "asc" } });
    expect(files.map((f) => [f.name, f.size, f.sha256])).toEqual([
      ["a.txt", 5n, sha256("hello")],
      ["b.txt", 6n, sha256("world!")],
    ]);
    const userRoot = join(layoutOf(root).users, accountId);
    expect(await readFile(join(userRoot, "Docs/Sub/b.txt"), "utf8")).toBe("world!");
    expect((await stat(join(userRoot, "a.txt"))).mode & 0o777).toBe(FILE_MODE);
    expect(await readdir(layoutOf(root).uploads)).toEqual([]);
  });

  it("skips files already there with the same size", async () => {
    const target = await openImportTarget(owner(), false);
    expect(await importFile(target, "a.txt", 5, source("hello"))).toEqual({ status: "skipped" });
    expect(await importFile(target, "Docs/Sub/b.txt", 6, source("world!"))).toEqual({ status: "skipped" });
    expect(await prisma.node.count({ where: { accountId, type: "FILE" } })).toBe(2);
  });

  it("keeps a different file with the same name next to it", async () => {
    const target = await openImportTarget(owner(), false);
    const result = await importFile(target, "a.txt", 7, source("goodbye"));
    expect(result.status === "imported" && result.file.name).toBe("a (2).txt");
  });

  it("checks the quota unless told to ignore it", async () => {
    const used = (await prisma.node.aggregate({ where: { accountId, type: "FILE" }, _sum: { size: true } }))._sum.size ?? 0n;
    const full = owner(used + 1n);
    await expect(importFile(await openImportTarget(full, false), "big.txt", 4, source("big!"))).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE" });
    expect((await importFile(await openImportTarget(full, true), "big.txt", 4, source("big!"))).status).toBe("imported");
  });
});

import { createHash } from "node:crypto";
import { rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { newLinkId, newNodeId } from "@/domain/ids";
import { db } from "@/server/db/client";
import { backfillModifiedAt } from "@/server/migrations/20261101-backfill-modified-at";
import { backfillSha256 } from "@/server/migrations/20261101-backfill-sha256";
import { DATA_MIGRATIONS } from "@/server/migrations/registry";
import { findRootFolder } from "@/server/repositories/node.repo";
import { redis } from "@/server/redis";
import { createAdminAccount } from "@/server/services/auth.service";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";

const prisma = db();
const accounts: string[] = [];

afterAll(async () => {
  for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  redis().disconnect();
});

/** An account with files stored the way older releases left them: no modifiedAt, some without a hash. */
async function olderFiles() {
  const accountId = (await createAdminAccount()).account.id;
  accounts.push(accountId);
  const root = (await findRootFolder(prisma, accountId))!.id;
  const dir = userRootOf(configuredVolumeRoot(), accountId);
  const add = async (name: string, content: string | null, data: { sha256?: string; missing?: boolean } = {}) => {
    const id = newNodeId();
    await prisma.node.create({ data: { id, accountId, parentId: root, type: "FILE", kind: "OTHER", name, size: BigInt(content?.length ?? 4), linkId: newLinkId(), ...data } });
    if (content !== null) await writeFile(join(dir, name), content);
    return id;
  };
  const onDisk = await add("old.txt", "old", { sha256: "a".repeat(64) });
  await utimes(join(dir, "old.txt"), new Date(Date.UTC(2021, 4, 6)), new Date(Date.UTC(2021, 4, 6)));
  const unhashed = await add("plain.txt", "hash me");
  const gone = await add("gone.txt", null, { missing: true });
  return { onDisk, unhashed, gone };
}

const noSave = async () => undefined;

describe("release backfills", () => {
  it("are registered so `npm run data:migrate` runs them on every deploy path", () => {
    expect(DATA_MIGRATIONS.map((step) => step.id)).toEqual(["20261101-backfill-modified-at", "20261101-backfill-sha256"]);
  });

  it("record the disk modification time of older files (creation time when missing)", async () => {
    const { onDisk, gone } = await olderFiles();
    await backfillModifiedAt.run({ db: prisma, cursor: null, save: noSave });
    const rows = await prisma.node.findMany({ where: { id: { in: [onDisk, gone] } }, select: { id: true, modifiedAt: true, createdAt: true } });
    expect(rows.find((row) => row.id === onDisk)!.modifiedAt?.toISOString()).toBe("2021-05-06T00:00:00.000Z");
    const missing = rows.find((row) => row.id === gone)!;
    expect(missing.modifiedAt?.getTime()).toBe(missing.createdAt.getTime());
    expect(await prisma.node.count({ where: { type: "FILE", modifiedAt: null } })).toBe(0);
  });

  it("hash files without a content hash and leave missing ones for fsck", async () => {
    const { onDisk, unhashed, gone } = await olderFiles();
    await backfillSha256.run({ db: prisma, cursor: null, save: noSave });
    const rows = await prisma.node.findMany({ where: { id: { in: [onDisk, unhashed, gone] } }, select: { id: true, sha256: true } });
    const hash = (id: string) => rows.find((row) => row.id === id)!.sha256;
    expect(hash(unhashed)).toBe(createHash("sha256").update("hash me").digest("hex"));
    expect(hash(onDisk)).toBe("a".repeat(64));
    expect(hash(gone)).toBeNull();
  });

  it("resume after the saved cursor", async () => {
    const { unhashed } = await olderFiles();
    const saved: string[] = [];
    await backfillSha256.run({ db: prisma, cursor: unhashed, save: async (cursor) => void saved.push(cursor) });
    expect((await prisma.node.findUniqueOrThrow({ where: { id: unhashed } })).sha256).toBeNull();
  });
});

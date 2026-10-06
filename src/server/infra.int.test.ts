import { afterAll, describe, expect, it, vi } from "vitest";
import { newAccountId, newLinkId, newNodeId } from "@/domain/ids";
import { db } from "./db/client";
import { cached, invalidate } from "./cache/cached";
import { redis } from "./redis";
import { checkHealth } from "./services/health.service";

const prisma = db();
const volumeId = `test-${newNodeId()}`;

afterAll(async () => {
  await prisma.storageVolume.deleteMany({ where: { id: volumeId } });
  await prisma.$disconnect();
  redis().disconnect();
});

async function createAccountWithRoot() {
  await prisma.storageVolume.upsert({ where: { id: volumeId }, create: { id: volumeId, mountPath: "/tmp/test-volume" }, update: {} });
  const accountId = newAccountId();
  const rootId = newNodeId();
  await prisma.account.create({
    data: {
      id: accountId,
      name: `anon-${accountId.slice(0, 6)}`,
      tokenLookup: `lookup-${accountId}`,
      tokenEnc: Buffer.from("enc"),
      color: "var(--accent)",
      volumeId,
      nodes: { create: { id: rootId, type: "FOLDER", name: "root", linkId: newLinkId() } },
    },
  });
  return { accountId, rootId };
}

describe("database schema", () => {
  it("enforces unique names within a folder", async () => {
    const { accountId, rootId } = await createAccountWithRoot();
    const node = (name: string) => ({ id: newNodeId(), accountId, parentId: rootId, type: "FILE" as const, name, linkId: newLinkId(), size: 10n });
    await prisma.node.create({ data: node("clip.mp4") });
    await expect(prisma.node.create({ data: node("clip.mp4") })).rejects.toThrow();
    await prisma.account.delete({ where: { id: accountId } });
  });

  it("deletes an account's nodes, sessions and events with it", async () => {
    const { accountId, rootId } = await createAccountWithRoot();
    const fileId = newNodeId();
    await prisma.node.create({ data: { id: fileId, accountId, parentId: rootId, type: "FILE", name: "a.txt", linkId: newLinkId(), tags: ["work", "movie"] } });
    await prisma.linkEvent.create({ data: { nodeId: fileId, kind: "DOWNLOAD", fileName: "a.txt" } });
    await prisma.session.create({ data: { id: newNodeId(), accountId, os: "Linux", browser: "Firefox", ipMasked: "1.2.•••.•••" } });

    const tagged = await prisma.node.findMany({ where: { accountId, tags: { hasEvery: ["movie", "work"] } } });
    expect(tagged.map((n) => n.id)).toEqual([fileId]);

    await prisma.account.delete({ where: { id: accountId } });
    expect(await prisma.node.count({ where: { accountId } })).toBe(0);
    expect(await prisma.session.count({ where: { accountId } })).toBe(0);
    expect(await prisma.linkEvent.count({ where: { nodeId: fileId } })).toBe(0);
  });
});

describe("redis cache", () => {
  it("loads once, round-trips bigint and invalidates", async () => {
    const key = `test:cache:${newNodeId()}`;
    const loader = vi.fn(async () => ({ size: 12_345_678_901_234n, name: "x" }));
    expect(await cached(key, 30, loader)).toEqual({ size: 12_345_678_901_234n, name: "x" });
    expect(await cached(key, 30, loader)).toEqual({ size: 12_345_678_901_234n, name: "x" });
    expect(loader).toHaveBeenCalledTimes(1);
    await invalidate([key]);
    await cached(key, 30, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    await invalidate([key]);
  });
});

describe("health", () => {
  it("reports database and redis as ok", async () => {
    const health = await checkHealth();
    expect(health.components.database).toBe("ok");
    expect(health.components.redis).toBe("ok");
    expect(["ok", "degraded"]).toContain(health.status);
  });
});

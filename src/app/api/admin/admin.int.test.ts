import { mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DELETE as deleteAccount, PATCH as manage } from "@/app/api/admin/accounts/[id]/route";
import { GET as listAccounts } from "@/app/api/admin/accounts/route";
import { POST as cleanup } from "@/app/api/admin/cleanup/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import type { SessionState } from "@/contracts/auth";
import type { AdminAccounts, CleanupResult } from "@/contracts/admin";
import { runMaintenance } from "@/server/jobs/maintenance";
import { createAdminAccount } from "@/server/services/auth.service";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup: done } = fileFixtures();
const admins: string[] = [];
const DAY = 86_400_000;

afterAll(async () => {
  await prisma.account.deleteMany({ where: { id: { in: admins } } });
  await done();
});

async function signedInAdmin() {
  const { account, token } = await createAdminAccount();
  admins.push(account.id);
  const res = await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() });
  return { id: account.id, cookie: res.cookie! };
}

const exists = (path: string) => stat(path).then(() => true, () => false);

describe("admin accounts", () => {
  it("is for admins only", async () => {
    const m = await member();
    expect((await callRoute(listAccounts, { cookie: m.cookie })).status).toBe(403);
    expect((await callRoute(cleanup, { method: "POST", cookie: m.cookie })).status).toBe(403);
  });

  it("lists accounts with usage and marks this device", async () => {
    const admin = await signedInAdmin();
    const m = await member();
    await addFile(m, m.rootId, [], "a.txt", "hello", "text/plain");
    const { accounts, ttlDays } = (await callRoute<AdminAccounts>(listAccounts, { cookie: admin.cookie })).json.data;
    expect(ttlDays).toBe(14);
    expect(accounts.find((row) => row.id === m.id)).toMatchObject({ files: 1, usedBytes: "5", here: false, you: false, isAdmin: false });
    expect(accounts.find((row) => row.id === admin.id)).toMatchObject({ here: true, you: true, isAdmin: true });
  });

  it("extends, exempts and limits accounts, and keeps one admin", async () => {
    const admin = await signedInAdmin();
    const m = await member();
    const created = (await prisma.account.findUniqueOrThrow({ where: { id: m.id } })).createdAt.getTime();
    const save = (id: string, body: object) => callRoute(manage, { method: "PATCH", cookie: admin.cookie, params: { id }, body });

    expect((await save(m.id, { isAdmin: false, days: 7, reset: false, quotaGb: 10 })).status).toBe(200);
    let row = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.expiresAt!.getTime()).toBe(created + 21 * DAY);
    expect(row.quotaBytes).toBe(10_000_000_000n);

    await save(m.id, { isAdmin: false, days: "never", reset: false, quotaGb: null });
    row = await prisma.account.findUniqueOrThrow({ where: { id: m.id } });
    expect([row.neverExpire, row.quotaBytes]).toEqual([true, null]);
    await save(m.id, { isAdmin: false, days: "default", reset: false, quotaGb: 5 });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: m.id } })).expiresAt).toBeNull();

    // Demoting every admin is refused while only one is left.
    const others = await prisma.account.findMany({ where: { isAdmin: true, id: { not: admin.id } }, select: { id: true } });
    await prisma.account.updateMany({ where: { id: { in: others.map((other) => other.id) } }, data: { isAdmin: false } });
    try {
      const last = await save(admin.id, { isAdmin: false, days: 0, reset: false, quotaGb: null });
      expect([last.status, last.json.error]).toEqual([400, "Keep at least one admin"]);
    } finally {
      await prisma.account.updateMany({ where: { id: { in: others.map((other) => other.id) } }, data: { isAdmin: true } });
    }
  });

  it("deletes members but not admins", async () => {
    const admin = await signedInAdmin();
    const m = await member();
    expect((await callRoute(deleteAccount, { method: "DELETE", cookie: admin.cookie, params: { id: admin.id } })).status).toBe(403);
    expect((await callRoute(deleteAccount, { method: "DELETE", cookie: admin.cookie, params: { id: m.id } })).status).toBe(200);
    expect(await prisma.account.findUnique({ where: { id: m.id } })).toBeNull();
  });
});

describe("cleanup", () => {
  it("deletes expired accounts and items now", async () => {
    const admin = await signedInAdmin();
    const old = await member();
    await prisma.account.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 20 * DAY) } });
    const m = await member();
    const gone = await addFile(m, m.rootId, [], "gone.txt", "x", "text/plain");
    await prisma.node.update({ where: { id: gone }, data: { expAt: new Date(Date.now() - DAY) } });

    const res = await callRoute<CleanupResult>(cleanup, { method: "POST", cookie: admin.cookie });
    expect(res.json.data.accounts).toBeGreaterThanOrEqual(1);
    expect(res.json.data.items).toBeGreaterThanOrEqual(1);
    expect(await prisma.account.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.node.findUnique({ where: { id: gone } })).toBeNull();
    expect(await prisma.account.findUnique({ where: { id: m.id } })).not.toBeNull();
  });

  it("empties old trash and abandoned uploads in the daily job", async () => {
    const layout = layoutOf(configuredVolumeRoot());
    await mkdir(layout.trash, { recursive: true });
    await mkdir(layout.uploads, { recursive: true });
    const oldTrash = join(layout.trash, "2020-01-01T00-00-00-000Z-acct-old.txt");
    const newTrash = join(layout.trash, `${new Date().toISOString().replace(/[:.]/g, "-")}-acct-new.txt`);
    const oldUpload = join(layout.uploads, `stale-${Date.now()}`);
    await Promise.all([writeFile(oldTrash, "x"), writeFile(newTrash, "y"), writeFile(oldUpload, "z")]);
    const longAgo = new Date(Date.now() - 30 * DAY);
    await utimes(oldUpload, longAgo, longAgo);

    const result = await runMaintenance(new Date());
    expect(result.trash).toBeGreaterThanOrEqual(1);
    expect(result.uploads).toBeGreaterThanOrEqual(1);
    expect([await exists(oldTrash), await exists(newTrash), await exists(oldUpload)]).toEqual([false, true, false]);
  });
});

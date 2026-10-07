import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import type { CreatedAccount } from "@/contracts/auth";
import { newLinkId, newNodeId } from "@/domain/ids";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { userRootOf } from "@/server/storage/safe-path";
import { callRoute } from "./route-call";

type NodeKind = "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";
type RouteHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/**
 * A random address in the 198.18.0.0/15 test range. Per-address limits (sign-ups, failed
 * sign-ins) live in Redis across runs, so tests must not reuse fixed addresses.
 */
export function randomTestIp(): string {
  const octet = () => Math.floor(Math.random() * 256);
  return `198.${18 + (octet() % 2)}.${octet()}.${octet()}`;
}

/**
 * Accounts and files written straight to the volume and the database, for integration tests
 * of file serving.
 */
export function fileFixtures() {
  const prisma = db();
  const accounts: string[] = [];
  /** Account folders to remove afterwards (each on the volume the account was placed on). */
  const dirs: string[] = [];

  async function member() {
    // A fresh address per account keeps tests under the per-address sign-up limit.
    const ip = randomTestIp();
    const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip });
    const id = res.json.data.account.id;
    // New accounts go to the volume with the most free space, which is not always STORAGE_ROOT
    // while another test has an extra volume registered.
    const { volume } = await prisma.account.findUniqueOrThrow({ where: { id }, select: { volume: { select: { mountPath: true } } } });
    const dir = userRootOf(volume.mountPath, id);
    accounts.push(id);
    dirs.push(dir);
    const root = await prisma.node.findFirstOrThrow({ where: { accountId: id, parentId: null } });
    return { id, cookie: res.cookie!, dir, rootId: root.id };
  }
  type Member = Awaited<ReturnType<typeof member>>;

  async function addFile(m: Member, parentId: string, segments: string[], name: string, content: string | Buffer, mime: string, kind: NodeKind = "OTHER") {
    const id = newNodeId();
    const bytes = Buffer.from(content);
    await mkdir(join(m.dir, ...segments), { recursive: true });
    await writeFile(join(m.dir, ...segments, name), bytes);
    await prisma.node.create({
      data: { id, accountId: m.id, parentId, type: "FILE", kind, mime, name, size: BigInt(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex"), linkId: newLinkId() },
    });
    return id;
  }

  async function get(handler: RouteHandler, m: Member, id: string, headers: Record<string, string> = {}) {
    const req = new NextRequest(`http://localhost/api/files/${id}`, { headers: { cookie: `${SESSION_COOKIE}=${m.cookie}`, ...headers } });
    return handler(req, { params: Promise.resolve({ id }) });
  }

  async function cleanup() {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.$disconnect();
    redis().disconnect();
  }

  return { prisma, member, addFile, get, cleanup };
}

export type FileFixtures = ReturnType<typeof fileFixtures>;
export type FixtureMember = Awaited<ReturnType<FileFixtures["member"]>>;

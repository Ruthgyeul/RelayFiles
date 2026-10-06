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
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";
import { callRoute } from "./route-call";

type NodeKind = "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";
type RouteHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/**
 * Accounts and files written straight to the volume and the database, for integration tests
 * of file serving. `ipBlock` keeps each test file's sign-up addresses apart.
 */
export function fileFixtures(ipBlock: number) {
  const prisma = db();
  const accounts: string[] = [];

  async function member() {
    // A fresh address per account keeps tests under the per-address sign-up limit.
    const ip = `198.18.${Math.floor(Math.random() * 250) + 1}.${ipBlock}`;
    const res = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: {}, ip });
    const id = res.json.data.account.id;
    accounts.push(id);
    const root = await prisma.node.findFirstOrThrow({ where: { accountId: id, parentId: null } });
    return { id, cookie: res.cookie!, dir: userRootOf(configuredVolumeRoot(), id), rootId: root.id };
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
    for (const id of accounts) await rm(userRootOf(configuredVolumeRoot(), id), { recursive: true, force: true });
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.$disconnect();
    redis().disconnect();
  }

  return { prisma, member, addFile, get, cleanup };
}

export type FileFixtures = ReturnType<typeof fileFixtures>;
export type FixtureMember = Awaited<ReturnType<FileFixtures["member"]>>;

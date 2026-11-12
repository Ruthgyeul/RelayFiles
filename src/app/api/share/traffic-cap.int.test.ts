import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { GET as shareZip } from "@/app/api/share/[linkId]/zip/route";
import { PUT as saveSettings } from "@/app/api/nodes/[id]/settings/route";
import { getEnv } from "@/config/env";
import type { NodeItem } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { secondsUntilUtcMidnight } from "@/domain/traffic";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { closeQueues } from "@/server/jobs/queue";
import { addTraffic } from "@/server/repositories/traffic.repo";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

async function visit<P>(handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>, path: string, params: P, owner?: FixtureMember) {
  const headers = new Headers({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0", "x-real-ip": randomTestIp() });
  if (owner) headers.set("cookie", `${SESSION_COOKIE}=${owner.cookie}`);
  return handler(new NextRequest(`http://localhost${path}`, { headers }), { params: Promise.resolve(params) });
}

/** A public folder "Trip" with a 10-byte file inside. */
async function sharedFolder(dailyBytesCap: bigint | null = null) {
  const m = await member();
  const id = newNodeId();
  const linkId = newLinkId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId: m.rootId, type: "FOLDER", name: "Trip", linkId, visibility: "PUBLIC", dailyBytesCap } });
  const file = await addFile(m, id, ["Trip"], "ten.txt", "0123456789", "text/plain");
  return { m, folderId: id, linkId, file };
}

const download = (linkId: string, id: string, owner?: FixtureMember) => visit(shareDownload, `/api/share/${linkId}/files/${id}/download`, { linkId, id }, owner);

describe("daily traffic limits", () => {
  it("refuses visitors once the link's bytes for the day are sent, until midnight UTC", async () => {
    const { m, folderId, linkId, file } = await sharedFolder(15n);
    const first = await download(linkId, file);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    // 10 of 15 bytes used: the next response may start and goes past the limit.
    const second = await download(linkId, file);
    expect(second.status).toBe(200);
    await second.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const refused = await download(linkId, file);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeLessThanOrEqual(secondsUntilUtcMidnight(Date.now()));
    expect(((await refused.json()) as { error: string }).error).toBe("This link has used up today's traffic. Try again after midnight UTC.");
    // The zip of the same link is refused too; the owner is never limited.
    expect((await visit(shareZip, `/api/share/${linkId}/zip?folder=${folderId}`, { linkId })).status).toBe(429);
    expect((await download(linkId, file, m)).status).toBe(200);
  });

  it("applies SHARE_DAILY_BYTES_CAP_GB to all links of an account", async () => {
    const policy = getEnv("policy") as { SHARE_DAILY_BYTES_CAP_GB?: number };
    const { m, linkId, file } = await sharedFolder();
    policy.SHARE_DAILY_BYTES_CAP_GB = 1;
    try {
      expect((await download(linkId, file)).status).toBe(200);
      await addTraffic(prisma, m.id, 1_000_000_000n, new Date());
      const refused = await download(linkId, file);
      expect(refused.status).toBe(429);
      expect(((await refused.json()) as { error: string }).error).toContain("daily sharing limit");
    } finally {
      delete policy.SHARE_DAILY_BYTES_CAP_GB;
    }
    expect((await download(linkId, file)).status).toBe(200);
  });

  it("saves the limit from the sharing settings and lists it with the item", async () => {
    const { m, folderId } = await sharedFolder();
    const res = await callRoute<NodeItem, { id: string }>(saveSettings, {
      method: "PUT",
      cookie: m.cookie,
      params: { id: folderId },
      body: { visibility: "public", expiry: "Never", burn: false, downloadLimit: null, dailyCapGb: 5, access: "both", note: "", applyDown: false },
    });
    expect(res.status).toBe(200);
    expect(res.json.data.settings.dailyCapGb).toBe(5);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: folderId } })).dailyBytesCap).toBe(5_000_000_000n);
    // Left out of a save, the limit stays.
    const kept = await callRoute<NodeItem, { id: string }>(saveSettings, {
      method: "PUT",
      cookie: m.cookie,
      params: { id: folderId },
      body: { visibility: "public", expiry: "Never", burn: false, downloadLimit: null, access: "both", note: "", applyDown: false },
    });
    expect(kept.json.data.settings.dailyCapGb).toBe(5);
  });
});

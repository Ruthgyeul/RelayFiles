import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { GET as shareStream } from "@/app/api/share/[linkId]/files/[id]/stream/route";
import { GET as shareThumb } from "@/app/api/share/[linkId]/files/[id]/thumb/route";
import { POST as unlock } from "@/app/api/share/[linkId]/unlock/route";
import { GET as shareZip, HEAD as shareZipCheck } from "@/app/api/share/[linkId]/zip/route";
import { SHARE } from "@/config/policy";
import { newLinkId, newNodeId } from "@/domain/ids";
import { hash } from "@node-rs/argon2";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { closeQueues } from "@/server/jobs/queue";
import { processMedia } from "@/server/media/process";
import { sharePage } from "@/server/services/share.service";
import { UNLOCK_COOKIE } from "@/server/share/unlock-cookie";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();
const noViewer = { accountIds: [], unlocks: new Map<string, number>() };

afterAll(async () => {
  await closeQueues();
  await cleanup();
});

const visitorIp = randomTestIp;

/** A request from a visitor (no account) or, with `owner`, from the owner's device. */
async function visit<P>(handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>, path: string, params: P, options: { owner?: FixtureMember; cookies?: string[]; headers?: Record<string, string>; method?: string; body?: unknown; ip?: string } = {}) {
  const cookies = [...(options.cookies ?? []), ...(options.owner ? [`${SESSION_COOKIE}=${options.owner.cookie}`] : [])];
  const headers = new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", "x-real-ip": options.ip ?? visitorIp(), ...options.headers });
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const req = new NextRequest(`http://localhost${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return handler(req, { params: Promise.resolve(params) });
}

async function folder(m: FixtureMember, parentId: string, name: string, data: Record<string, unknown> = {}) {
  const id = newNodeId();
  const linkId = newLinkId();
  await prisma.node.create({ data: { id, accountId: m.id, parentId, type: "FOLDER", name, linkId, ...data } });
  return { id, linkId };
}

const cameraJpeg = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: "#f5b400" } })
    .jpeg()
    .withExif({ IFD0: { Make: "RelayCam", Model: "Pocket 9" } })
    .toBuffer();

/** Trip (public, with a note) → a.txt, photo.jpg, Day1/b.txt, Hidden (private)/secret.txt. */
async function sharedTrip(data: Record<string, unknown> = {}) {
  const m = await member();
  const trip = await folder(m, m.rootId, "Trip", { visibility: "PUBLIC", note: "Pictures from the weekend", ...data });
  const a = await addFile(m, trip.id, ["Trip"], "a.txt", "alpha", "text/plain");
  const photo = await addFile(m, trip.id, ["Trip"], "photo.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
  const day = await folder(m, trip.id, "Day1");
  const b = await addFile(m, day.id, ["Trip", "Day1"], "b.txt", "bravo", "text/plain");
  const hidden = await folder(m, trip.id, "Hidden", { visibility: "PRIVATE" });
  const secret = await addFile(m, hidden.id, ["Trip", "Hidden"], "secret.txt", "classified", "text/plain");
  return { m, trip, a, photo, day, b, hidden, secret };
}

const fileParams = (linkId: string, id: string) => ({ linkId, id });
const path = (linkId: string, id: string, mode: string) => `/api/share/${linkId}/files/${id}/${mode}`;

describe("share page", () => {
  it("lists only what visitors may see, with sizes, tags and the note", async () => {
    const { trip, hidden, day } = await sharedTrip({ downloadLimit: 5 });
    const result = (await sharePage(trip.linkId, null, noViewer, Date.now()))!;
    expect(result.page.status).toBe("open");
    expect(result.page.owner).toBeNull();
    const view = result.page.view!;
    expect(view.items.map((item) => item.name)).toEqual(["Day1", "a.txt", "photo.jpg"]);
    expect(view.items[0]).toMatchObject({ type: "folder", itemCount: 1, size: "5" });
    expect(view.note).toBe("Pictures from the weekend");
    expect(view.tags.map((tag) => tag.label)).toEqual(["0 / 5 downloads"]);
    expect(view.crumbs.map((crumb) => crumb.name)).toEqual(["Trip"]);

    const sub = (await sharePage(trip.linkId, day.id, noViewer, Date.now()))!.page.view!;
    expect([sub.folder.name, sub.note, sub.crumbs.map((crumb) => crumb.name)]).toEqual(["Day1", null, ["Trip", "Day1"]]);
    expect(await sharePage(trip.linkId, hidden.id, noViewer, Date.now())).toBeNull();
    expect(await sharePage(newLinkId(), null, noViewer, Date.now())).toBeNull();
  });

  it("shows expired, blocked, private and password states in the design's order", async () => {
    const now = Date.now();
    const statusOf = async (data: Record<string, unknown>) => {
      const { trip } = await sharedTrip(data);
      return (await sharePage(trip.linkId, null, noViewer, now))!.page.status;
    };
    expect(await statusOf({ expAt: new Date(now - 1_000) })).toBe("expired");
    expect(await statusOf({ burn: true, downloads: 1 })).toBe("expired");
    expect(await statusOf({ downloadLimit: 2, downloads: 2 })).toBe("blocked");
    expect(await statusOf({ visibility: "INHERIT" })).toBe("private");
    expect(await statusOf({ passwordHash: await hash("open sesame") })).toBe("locked");
  });

  it("unlocks with the right password and limits wrong guesses", async () => {
    const { trip, a } = await sharedTrip({ passwordHash: await hash("open sesame") });
    const ip = visitorIp();
    const locked = await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { ip });
    expect(locked.status).toBe(401);

    const wrong = await visit(unlock, `/api/share/${trip.linkId}/unlock`, { linkId: trip.linkId }, { method: "POST", body: { password: "nope" }, ip });
    expect([wrong.status, ((await wrong.json()) as { error: string }).error]).toEqual([403, "Wrong password"]);
    const right = await visit(unlock, `/api/share/${trip.linkId}/unlock`, { linkId: trip.linkId }, { method: "POST", body: { password: "open sesame" }, ip });
    expect(right.status).toBe(200);
    const cookie = right.headers.getSetCookie().find((line) => line.startsWith(`${UNLOCK_COOKIE}=`))!.split(";")[0]!;
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { cookies: [cookie] })).status).toBe(200);

    const guesser = visitorIp();
    for (let attempt = 0; attempt < SHARE.unlockMaxAttempts; attempt++) {
      await visit(unlock, `/api/share/${trip.linkId}/unlock`, { linkId: trip.linkId }, { method: "POST", body: { password: `guess ${attempt}` }, ip: guesser });
    }
    const blocked = await visit(unlock, `/api/share/${trip.linkId}/unlock`, { linkId: trip.linkId }, { method: "POST", body: { password: "open sesame" }, ip: guesser });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("share previews", () => {
  it("lists which files have a preview and serves it without counting or logging", async () => {
    const { trip, a, photo } = await sharedTrip({ access: "STREAM" });
    await processMedia(photo);
    const items = (await sharePage(trip.linkId, null, noViewer, Date.now()))!.page.view!.items;
    expect(items.map((item) => [item.name, item.hasThumb])).toEqual([
      ["Day1", false],
      ["a.txt", false],
      ["photo.jpg", true],
    ]);

    // Stream-only links still show previews; thumbnails carry no camera data.
    const res = await visit(shareThumb, path(trip.linkId, photo, "thumb"), fileParams(trip.linkId, photo));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const preview = Buffer.from(await res.arrayBuffer());
    expect(preview.includes(Buffer.from("RelayCam"))).toBe(false);
    expect((await visit(shareThumb, path(trip.linkId, photo, "thumb"), fileParams(trip.linkId, photo), { headers: { "if-none-match": res.headers.get("etag")! } })).status).toBe(304);
    expect(await prisma.node.findMany({ where: { id: { in: [photo, trip.id] } }, select: { downloads: true } })).toEqual([{ downloads: 0 }, { downloads: 0 }]);
    expect(await prisma.linkEvent.count({ where: { nodeId: photo } })).toBe(0);

    // Files without a preview, and files of other accounts, are not found.
    expect((await visit(shareThumb, path(trip.linkId, a, "thumb"), fileParams(trip.linkId, a))).status).toBe(404);
    const other = await member();
    const elsewhere = await addFile(other, other.rootId, [], "x.jpg", await cameraJpeg(), "image/jpeg", "IMAGE");
    await processMedia(elsewhere);
    expect((await visit(shareThumb, path(trip.linkId, elsewhere, "thumb"), fileParams(trip.linkId, elsewhere))).status).toBe(404);
  });

  it("follows the link's state: private items, passwords and expiry", async () => {
    const locked = await sharedTrip({ passwordHash: await hash("open sesame") });
    await processMedia(locked.photo);
    expect((await visit(shareThumb, path(locked.trip.linkId, locked.photo, "thumb"), fileParams(locked.trip.linkId, locked.photo))).status).toBe(401);

    const expired = await sharedTrip({ expAt: new Date(Date.now() - 1_000) });
    await processMedia(expired.photo);
    expect((await visit(shareThumb, path(expired.trip.linkId, expired.photo, "thumb"), fileParams(expired.trip.linkId, expired.photo))).status).toBe(410);

    const hiddenPhoto = await sharedTrip();
    await prisma.node.update({ where: { id: hiddenPhoto.photo }, data: { visibility: "PRIVATE" } });
    await processMedia(hiddenPhoto.photo);
    expect((await visit(shareThumb, path(hiddenPhoto.trip.linkId, hiddenPhoto.photo, "thumb"), fileParams(hiddenPhoto.trip.linkId, hiddenPhoto.photo))).status).toBe(404);
  });
});

describe("share downloads", () => {
  it("counts visitor downloads on the file and the link and logs them", async () => {
    const { m, trip, a, secret } = await sharedTrip();
    const res = await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="a.txt"');
    expect(await res.text()).toBe("alpha");
    const counts = await prisma.node.findMany({ where: { id: { in: [a, trip.id] } }, select: { id: true, downloads: true } });
    expect(counts.map((row) => row.downloads)).toEqual([1, 1]);
    const events = await prisma.linkEvent.findMany({ where: { nodeId: a } });
    expect(events).toMatchObject([{ kind: "DOWNLOAD", fileName: "a.txt", device: "iPhone · Safari" }]);

    // The owner previewing the page is not counted; private items are not reachable.
    await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { owner: m });
    expect((await prisma.node.findUniqueOrThrow({ where: { id: a } })).downloads).toBe(1);
    expect((await visit(shareDownload, path(trip.linkId, secret, "download"), fileParams(trip.linkId, secret))).status).toBe(404);
  });

  it("allows streaming but not downloading on stream-only links", async () => {
    const { trip, a } = await sharedTrip({ access: "STREAM" });
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a))).status).toBe(403);
    expect((await visit(shareStream, path(trip.linkId, a, "stream"), fileParams(trip.linkId, a))).status).toBe(200);
    expect((await visit(shareZip, `/api/share/${trip.linkId}/zip?folder=${trip.id}`, { linkId: trip.linkId })).status).toBe(403);
  });

  it("sends images without camera data unless the owner turned that off", async () => {
    const { m, trip, photo } = await sharedTrip();
    const cleaned = Buffer.from(await (await visit(shareDownload, path(trip.linkId, photo, "download"), fileParams(trip.linkId, photo))).arrayBuffer());
    expect(cleaned.includes(Buffer.from("RelayCam"))).toBe(false);
    expect((await sharp(cleaned).metadata()).width).toBe(8);

    await prisma.account.update({ where: { id: m.id }, data: { stripMetadataOnShare: false } });
    const original = Buffer.from(await (await visit(shareStream, path(trip.linkId, photo, "stream"), fileParams(trip.linkId, photo))).arrayBuffer());
    expect(original.includes(Buffer.from("RelayCam"))).toBe(true);
  });

  it("pauses downloads after 10 in 10 minutes and says when to retry", async () => {
    const { trip, a } = await sharedTrip();
    for (let index = 0; index < SHARE.busyPauseAt; index++) {
      expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a))).status).toBe(200);
    }
    const busy = await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a));
    expect(busy.status).toBe(429);
    expect(Number(busy.headers.get("retry-after"))).toBeGreaterThan(0);
    const item = (await sharePage(trip.linkId, null, noViewer, Date.now()))!.page.view!.items.find((entry) => entry.name === "a.txt")!;
    expect(item.busy?.label).toMatch(/^Server busy · retry in \d+m$/);
    expect(item.canDownload).toBe(false);
  });

  it("zips the visible contents for Download all", async () => {
    const { trip, a } = await sharedTrip();
    // The page's HEAD check before a download counts nothing.
    expect((await visit(shareZipCheck, `/api/share/${trip.linkId}/zip?folder=${trip.id}`, { linkId: trip.linkId }, { method: "HEAD" })).status).toBe(200);
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { method: "HEAD" })).status).toBe(200);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: trip.id } })).downloads).toBe(0);
    const res = await visit(shareZip, `/api/share/${trip.linkId}/zip?folder=${trip.id}`, { linkId: trip.linkId });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Trip.zip"');
    const body = Buffer.from(await res.arrayBuffer());
    for (const text of ["Trip/a.txt", "Trip/Day1/b.txt", "Trip/photo.jpg", "alpha", "bravo"]) expect(body.includes(Buffer.from(text)), text).toBe(true);
    for (const text of ["Hidden", "classified", "RelayCam"]) expect(body.includes(Buffer.from(text)), text).toBe(false);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: trip.id } })).downloads).toBe(1);
  });
});

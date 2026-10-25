import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { GET as shareDownload } from "@/app/api/share/[linkId]/files/[id]/download/route";
import { GET as shareStream } from "@/app/api/share/[linkId]/files/[id]/stream/route";
import { GET as sharePreview } from "@/app/api/share/[linkId]/files/[id]/preview/route";
import { GET as shareThumb } from "@/app/api/share/[linkId]/files/[id]/thumb/route";
import { POST as unlock } from "@/app/api/share/[linkId]/unlock/route";
import { GET as shareZip, HEAD as shareZipCheck } from "@/app/api/share/[linkId]/zip/route";
import { DOCUMENT_PREVIEW, IMMUTABLE_CACHE, MEDIA, SHARE } from "@/config/policy";
import { PREFETCH_HEADER } from "@/contracts/api";
import { newLinkId, newNodeId } from "@/domain/ids";
import { hash } from "@node-rs/argon2";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { closeQueues } from "@/server/jobs/queue";
import { processMedia } from "@/server/media/process";
import { getFolderView } from "@/server/services/node.service";
import { retiredSharePage, sharePage } from "@/server/services/share.service";
import { purgeExpired } from "@/server/services/profile.service";
import { findAccountById } from "@/server/repositories/account.repo";
import { purgeRetiredLinks } from "@/server/repositories/link-tombstone.repo";
import { UNLOCK_COOKIE, type Unlocks } from "@/server/share/unlock-cookie";
import { layoutOf } from "@/server/storage/layout";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { fileFixtures, randomTestIp, type FixtureMember } from "../../../../test/file-fixtures";

const { prisma, member, addFile, cleanup } = fileFixtures();
const noViewer = { accountIds: [], unlocks: new Map() as Unlocks };

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

  it("still says a link expired after its items were deleted", async () => {
    const { m, trip, a } = await sharedTrip({ expAt: new Date(Date.now() - 1_000) });
    const linkOf = async (id: string) => (await prisma.node.findUniqueOrThrow({ where: { id } })).linkId;
    const fileLink = await linkOf(a);
    const owner = (await findAccountById(prisma, m.id))!;
    expect((await purgeExpired(owner, new Date())).deleted).toBeGreaterThan(0);
    expect(await prisma.node.count({ where: { id: { in: [trip.id, a] } } })).toBe(0);

    // The link and the links of everything that was inside it.
    expect(await sharePage(trip.linkId, null, noViewer, Date.now())).toBeNull();
    expect(await retiredSharePage(trip.linkId)).toMatchObject({ status: "expired", view: null, owner: null });
    expect(await retiredSharePage(fileLink)).toMatchObject({ status: "expired" });
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a))).status).toBe(410);

    // Links that never existed stay "not found", and old records are forgotten.
    expect(await retiredSharePage(newLinkId())).toBeNull();
    await purgeRetiredLinks(prisma, new Date(Date.now() + 1_000));
    expect(await retiredSharePage(trip.linkId)).toBeNull();
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
  it("locks out devices that unlocked with a password that has since changed", async () => {
    const { trip, a } = await sharedTrip({ passwordHash: await hash("first") });
    const ip = visitorIp();
    const right = await visit(unlock, `/api/share/${trip.linkId}/unlock`, { linkId: trip.linkId }, { method: "POST", body: { password: "first" }, ip });
    const cookie = right.headers.getSetCookie().find((line) => line.startsWith(`${UNLOCK_COOKIE}=`))!.split(";")[0]!;
    const download = () => visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { cookies: [cookie], ip });
    expect((await download()).status).toBe(200);

    await prisma.node.update({ where: { id: trip.id }, data: { passwordHash: await hash("second") } });
    expect((await download()).status).toBe(401);
  });

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

  it("streams the worker's stripped copy from disk, range by range", async () => {
    const { m, trip, photo } = await sharedTrip();
    await processMedia(photo);
    const copy = await readFile(join(layoutOf(configuredVolumeRoot()).derived, m.id, photo));
    expect(copy.includes(Buffer.from("RelayCam"))).toBe(false);

    const whole = await visit(shareStream, path(trip.linkId, photo, "stream"), fileParams(trip.linkId, photo));
    expect(whole.headers.get("content-length")).toBe(String(copy.length));
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(copy);

    const part = await visit(shareStream, path(trip.linkId, photo, "stream"), fileParams(trip.linkId, photo), { headers: { range: "bytes=2-9" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 2-9/${copy.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(copy.subarray(2, 10));
  });

  it("shows visitors the screen-sized preview, counts views but not look-aheads, and lets the browser keep playback", async () => {
    const { m, trip } = await sharedTrip();
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg({ quality: 95 })
      .withExif({ IFD0: { Make: "RelayCam", Model: "Pocket 9" } })
      .toBuffer();
    const id = await addFile(m, trip.id, ["Trip"], "big.jpg", big, "image/jpeg", "IMAGE");
    expect((await processMedia(id))?.preview).toBe(true);
    const views = () => prisma.linkEvent.count({ where: { nodeId: id, kind: "VIEW" } });

    const ahead = await visit(sharePreview, path(trip.linkId, id, "preview"), fileParams(trip.linkId, id), { headers: { [PREFETCH_HEADER]: "1" } });
    expect(ahead.headers.get("content-type")).toBe("image/webp");
    expect(ahead.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    const shown = Buffer.from(await ahead.arrayBuffer());
    expect(shown.includes(Buffer.from("RelayCam"))).toBe(false);
    expect((await sharp(shown).metadata()).width).toBe(MEDIA.previewSizePx);
    expect(await views()).toBe(0);

    // Opened in the viewer: that is the view.
    expect((await visit(sharePreview, path(trip.linkId, id, "preview"), fileParams(trip.linkId, id))).status).toBe(200);
    await expect.poll(views).toBe(1);

    // Playback is kept by the browser for good; downloads are checked (and counted) every time.
    const played = await visit(shareStream, path(trip.linkId, id, "stream"), fileParams(trip.linkId, id), { headers: { range: "bytes=0-99" } });
    expect(played.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    const downloaded = await visit(shareDownload, path(trip.linkId, id, "download"), fileParams(trip.linkId, id));
    expect(downloaded.headers.get("cache-control")).toBe("private, no-cache");
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

  it("shows the owner how busy a shared item is in the file manager", async () => {
    const { m, trip, a } = await sharedTrip();
    const busyOf = async () => (await getFolderView(m.id, trip.id)).children.find((entry) => entry.name === "a.txt")!.busy;
    expect(await busyOf()).toBeNull();
    for (let index = 0; index < SHARE.busyThrottleAt; index++) await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a));
    expect(await busyOf()).toMatchObject({ level: 1, label: "Busy" });
    for (let index = SHARE.busyThrottleAt; index < SHARE.busyPauseAt; index++) await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a));
    expect(await busyOf()).toMatchObject({ level: 2, label: "Server busy" });
    // The folder that holds the link counts too.
    expect((await getFolderView(m.id, m.rootId)).children.find((entry) => entry.name === "Trip")!.busy).toMatchObject({ level: 2 });
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

  it("counts suffix ranges and serves later ranges only after a counted start", async () => {
    const { trip, a } = await sharedTrip({ downloadLimit: 3 });
    const ip = visitorIp();
    const get = (range: string, from = ip) => visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { headers: { range }, ip: from });
    const downloads = async () => (await prisma.node.findUniqueOrThrow({ where: { id: a } })).downloads;

    // A suffix range that covers the whole file is a download like any other.
    const whole = await get("bytes=-99999999999");
    expect([whole.status, await whole.text()]).toEqual([206, "alpha"]);
    expect(await downloads()).toBe(1);

    // Resuming is served to the visitor who started; anyone else has to start (and be counted).
    const resumed = await get("bytes=1-");
    expect([resumed.status, await resumed.text()]).toEqual([206, "lpha"]);
    expect((await get("bytes=1-", visitorIp())).status).toBe(403);
    expect(await downloads()).toBe(1);
  });

  it("expires a delete-after-download link after one download, whatever the range", async () => {
    const { trip, a } = await sharedTrip({ burn: true });
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { headers: { range: "bytes=-5" } })).status).toBe(206);
    expect((await visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a), { headers: { range: "bytes=-5" } })).status).toBe(410);
  });

  it("lets only one of many simultaneous downloads take the last one", async () => {
    const { trip, a } = await sharedTrip();
    await prisma.node.update({ where: { id: a }, data: { downloadLimit: 1 } });
    const results = await Promise.all(Array.from({ length: 6 }, () => visit(shareDownload, path(trip.linkId, a, "download"), fileParams(trip.linkId, a))));
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect((await prisma.node.findUniqueOrThrow({ where: { id: a } })).downloads).toBe(1);
  });

  it("plays what the viewer reads, not whole files of any type", async () => {
    const { m, trip } = await sharedTrip({ access: "STREAM" });
    const archive = await addFile(m, trip.id, ["Trip"], "backup.zip", "PK archive bytes", "application/zip");
    const log = await addFile(m, trip.id, ["Trip"], "big.log", Buffer.alloc(DOCUMENT_PREVIEW.textMaxBytes + 10, "x"), "text/plain");
    const stream = (id: string, headers: Record<string, string> = {}) => visit(shareStream, path(trip.linkId, id, "stream"), fileParams(trip.linkId, id), { headers });

    expect((await stream(archive)).status).toBe(404);
    expect((await stream(log)).status).toBe(403);
    expect((await stream(log, { range: `bytes=${DOCUMENT_PREVIEW.textMaxBytes}-` })).status).toBe(403);
    const head = await stream(log, { range: `bytes=0-${DOCUMENT_PREVIEW.textMaxBytes - 1}` });
    expect([head.status, head.headers.get("content-length")]).toEqual([206, String(DOCUMENT_PREVIEW.textMaxBytes)]);
    // The owner's own preview is not limited.
    expect((await visit(shareStream, path(trip.linkId, archive, "stream"), fileParams(trip.linkId, archive), { owner: m })).status).toBe(200);
  });

  it("leaves files out of Download all like single downloads, and counts the ones included", async () => {
    const { m, trip, a, b } = await sharedTrip();
    const once = await addFile(m, trip.id, ["Trip"], "once.txt", "only once", "text/plain");
    const watch = await addFile(m, trip.id, ["Trip"], "watch.txt", "stream me", "text/plain");
    const paused = await addFile(m, trip.id, ["Trip"], "paused.txt", "on hold", "text/plain");
    await prisma.node.update({ where: { id: once }, data: { downloadLimit: 1, downloads: 1 } });
    await prisma.node.update({ where: { id: watch }, data: { access: "STREAM" } });
    await prisma.node.update({ where: { id: paused }, data: { dlPaused: true } });

    const res = await visit(shareZip, `/api/share/${trip.linkId}/zip?folder=${trip.id}`, { linkId: trip.linkId });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    for (const text of ["alpha", "bravo", "Not included.txt", "Trip/once.txt  (Download limit reached)", "Trip/watch.txt  (Stream only)", "Trip/paused.txt  (Downloads paused)"]) expect(body.includes(Buffer.from(text)), text).toBe(true);
    for (const text of ["only once", "stream me", "on hold"]) expect(body.includes(Buffer.from(text)), text).toBe(false);
    const counts = await prisma.node.findMany({ where: { id: { in: [a, b, once] } }, select: { id: true, downloads: true } });
    expect(Object.fromEntries(counts.map((row) => [row.id, row.downloads]))).toEqual({ [a]: 1, [b]: 1, [once]: 1 });
  });
});

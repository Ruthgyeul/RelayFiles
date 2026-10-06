import { access, rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as signout } from "@/app/api/auth/signout/route";
import { POST as switchAccount } from "@/app/api/auth/switch/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { GET as meToken } from "@/app/api/me/token/route";
import type { CreatedAccount, SessionState } from "@/contracts/auth";
import { newInviteCode } from "@/domain/ids";
import { ipKeyOf } from "@/server/auth/client-info";
import { clearFailures } from "@/server/auth/login-limiter";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis";
import { createAdminAccount } from "@/server/services/auth.service";
import { configuredVolumeRoot } from "@/server/storage/registry";
import { userRootOf } from "@/server/storage/safe-path";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, never>> }) => Promise<Response>;

const prisma = db();
const created: string[] = [];
const runId = Math.floor(Math.random() * 200) + 20;
/** Each test uses its own documentation-range address so lockouts never leak between tests. */
let ipCounter = 0;
const nextIp = () => `198.51.${runId}.${++ipCounter}`;

async function call<T>(handler: Handler, { body, cookie, ip, method = "POST", query = "" }: { body?: unknown; cookie?: string; ip?: string; method?: string; query?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0" });
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  if (ip) headers.set("x-real-ip", ip);
  const req = new NextRequest(`http://localhost/api/test${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve({}) });
  const setCookie = res.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
  const nextCookie = setCookie === undefined ? cookie : setCookie.split(";")[0]!.slice(SESSION_COOKIE.length + 1);
  const json = (await res.json()) as { success: boolean; data: T; code?: string; error?: string; retryAfter?: number };
  return { status: res.status, json, cookie: nextCookie || undefined, setCookie };
}

async function createAnon(ip = nextIp(), cookie?: string, body: unknown = {}) {
  const res = await call<CreatedAccount>(anonymous, { body, cookie, ip });
  if (res.json.success) created.push(res.json.data.account.id);
  return res;
}

async function setSignupMode(mode: "OPEN" | "INVITE" | "CLOSED") {
  await prisma.serverConfig.upsert({ where: { id: 1 }, create: { id: 1, signupMode: mode }, update: { signupMode: mode } });
}

beforeAll(() => setSignupMode("OPEN"));

afterAll(async () => {
  await setSignupMode("OPEN");
  const root = configuredVolumeRoot();
  for (const id of created) await rm(userRootOf(root, id), { recursive: true, force: true });
  await prisma.account.deleteMany({ where: { id: { in: created } } });
  for (let i = 1; i <= ipCounter; i++) {
    const key = ipKeyOf(`198.51.${runId}.${i}`);
    await clearFailures(key);
    await redis().del(`auth:signup:${key}`);
  }
  await prisma.$disconnect();
  redis().disconnect();
});

describe("anonymous accounts", () => {
  it("creates the account, its root folder on disk and a device session", async () => {
    const res = await createAnon();
    expect(res.status).toBe(201);
    const { account, token, session: state } = res.json.data;
    expect(token).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(account.name).toMatch(/^anon-/);
    expect(account.isAdmin).toBe(false);
    expect(account.deletesAt).not.toBeNull();
    expect(state.activeAccountId).toBe(account.id);
    expect(state.usage).toEqual({ usedBytes: "0", rootItems: 0 });
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=lax/i);

    await access(userRootOf(configuredVolumeRoot(), account.id));
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id }, include: { nodes: true, sessions: true } });
    expect(row.nodes).toHaveLength(1);
    expect(row.nodes[0]!.parentId).toBeNull();
    expect(row.sessions[0]).toMatchObject({ os: "Linux", browser: "Firefox", ipMasked: expect.stringMatching(/^198\.51\.•••\.•••$/) });
    // The plain token never reaches the database.
    expect(JSON.stringify(row, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(token);
  });

  it("reveals the token to its owner and reads the session back", async () => {
    const res = await createAnon();
    const state = await call<SessionState>(session, { method: "GET", cookie: res.cookie });
    expect(state.json.data.accounts.map((a) => a.id)).toEqual([res.json.data.account.id]);
    const revealed = await call<{ token: string }>(meToken, { method: "GET", cookie: res.cookie });
    expect(revealed.json.data.token).toBe(res.json.data.token);
  });

  it("requires a session to reveal a token", async () => {
    const res = await call(meToken, { method: "GET" });
    expect(res.status).toBe(401);
    expect(res.json.code).toBe("UNAUTHORIZED");
  });
});

describe("token sign-in, multi-account and sign-out", () => {
  it("signs out, signs back in with the token, and refuses duplicates", async () => {
    const ip = nextIp();
    const first = await createAnon(ip);
    const { token, account } = first.json.data;

    const out = await call<SessionState>(signout, { cookie: first.cookie, body: {} });
    expect(out.json.data.accounts).toEqual([]);
    expect(out.setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    // The old cookie no longer works: the session was revoked in the database.
    const stale = await call<SessionState>(session, { method: "GET", cookie: first.cookie });
    expect(stale.json.data.accounts).toEqual([]);

    const back = await call<SessionState>(tokenSignIn, { body: { token }, ip });
    expect(back.status).toBe(200);
    expect(back.json.data.activeAccountId).toBe(account.id);

    const again = await call(tokenSignIn, { body: { token }, ip, cookie: back.cookie });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("ALREADY_SIGNED_IN");
  });

  it("keeps several accounts on one device and switches between them", async () => {
    const ip = nextIp();
    const a = await createAnon(ip);
    const b = await createAnon(ip, a.cookie);
    const ids = [a.json.data.account.id, b.json.data.account.id];
    expect(b.json.data.session.accounts.map((x) => x.id)).toEqual(ids);
    expect(b.json.data.session.activeAccountId).toBe(ids[1]);

    const switched = await call<SessionState>(switchAccount, { body: { accountId: ids[0] }, cookie: b.cookie });
    expect(switched.json.data.activeAccountId).toBe(ids[0]);
    const read = await call<SessionState>(session, { method: "GET", cookie: switched.cookie });
    expect(read.json.data.activeAccountId).toBe(ids[0]);

    const foreign = await call(switchAccount, { body: { accountId: "abcdefghjkmn" }, cookie: switched.cookie });
    expect(foreign.status).toBe(404);

    // Tokens of other accounts on this device can be revealed ("Copy token" menu), foreign ones cannot.
    const other = await call<{ token: string }>(meToken, { method: "GET", cookie: switched.cookie, query: `?accountId=${ids[1]}` });
    expect(other.json.data.token).toBe(b.json.data.token);
    expect((await call(meToken, { method: "GET", cookie: switched.cookie, query: "?accountId=abcdefghjkmn" })).status).toBe(404);

    const out = await call<SessionState>(signout, { body: { accountId: ids[0] }, cookie: switched.cookie });
    expect(out.json.data.accounts.map((x) => x.id)).toEqual([ids[1]]);
    expect(out.json.data.activeAccountId).toBe(ids[1]);
  });

  it("rejects forged cookies", async () => {
    const res = await createAnon();
    const forged = `${res.cookie!.split(".")[0]}.AAAA`;
    const state = await call<SessionState>(session, { method: "GET", cookie: forged });
    expect(state.json.data.accounts).toEqual([]);
  });
});

describe("lockout", () => {
  it("follows the design ladder and blocks even a valid token while locked", async () => {
    const valid = (await createAnon()).json.data.token;
    const ip = nextIp();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await call(tokenSignIn, { body: { token: "short" }, ip });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe(`Tokens are 40 characters. ${5 - attempt} attempts left before a lockout.`);
    }
    const locked = await call(tokenSignIn, { body: { token: "x".repeat(40) }, ip });
    expect(locked.status).toBe(429);
    expect(locked.json.retryAfter).toBe(30);
    const blocked = await call(tokenSignIn, { body: { token: valid }, ip });
    expect(blocked.status).toBe(429);
    expect(blocked.json.retryAfter).toBeGreaterThan(0);
  });
});

describe("sign-up modes", () => {
  it("honors closed and invite-only modes", async () => {
    await setSignupMode("CLOSED");
    const closed = await createAnon();
    expect(closed.status).toBe(403);
    expect(closed.json.code).toBe("SIGNUP_CLOSED");

    await setSignupMode("INVITE");
    expect((await createAnon()).json.code).toBe("INVALID_INVITE");
    const code = newInviteCode();
    await prisma.invite.create({ data: { code } });
    const invited = await createAnon(nextIp(), undefined, { inviteCode: code.toLowerCase() });
    expect(invited.status).toBe(201);
    const invite = await prisma.invite.findUniqueOrThrow({ where: { code } });
    expect(invite.usedByName).toBe(invited.json.data.account.name);
    expect((await createAnon(nextIp(), undefined, { inviteCode: code })).json.code).toBe("INVALID_INVITE");
    await prisma.invite.delete({ where: { code } });
    await setSignupMode("OPEN");
  });

  it("creates admins that never expire and have no quota", async () => {
    const { account, token, sessionId } = await createAdminAccount();
    created.push(account.id);
    expect(token).toHaveLength(40);
    expect(sessionId).toBeNull();
    expect(account).toMatchObject({ isAdmin: true, neverExpire: true, quotaBytes: null });
  });
});

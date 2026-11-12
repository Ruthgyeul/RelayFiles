import { afterAll, describe, expect, it } from "vitest";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import { AUTH, MS } from "@/config/policy";
import { getEnv } from "@/config/env";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../../test/file-fixtures";
import { GET as revealToken } from "@/app/api/me/token/route";
import { POST as reauth } from "./route";

const { prisma, member, cleanup } = fileFixtures();

afterAll(cleanup);

const WRONG = "x".repeat(40);

/** A member whose sign-in is older than the re-authentication window, with its real token. */
async function olderMember() {
  const m = await member();
  const token = (await callRoute<{ token: string }>(revealToken, { cookie: m.cookie })).json.data.token;
  await prisma.session.updateMany({ where: { accountId: m.id }, data: { createdAt: new Date(Date.now() - (AUTH.reauthWindowMin + 1) * MS.minute) } });
  return { ...m, token };
}

describe("re-entering the token", () => {
  it("is not locked out by wrong sign-ins from the same address", async () => {
    const m = await olderMember();
    const ip = randomTestIp();
    const attempts = getEnv("policy").LOGIN_MAX_ATTEMPTS;
    for (let i = 0; i < attempts; i++) await callRoute(tokenSignIn, { method: "POST", body: { token: WRONG }, ip });
    expect((await callRoute(tokenSignIn, { method: "POST", body: { token: WRONG }, ip })).status).toBe(429);
    expect((await callRoute(reauth, { method: "POST", cookie: m.cookie, body: { token: m.token }, ip })).status).toBe(200);
  });

  it("locks per account after too many wrong tokens, from any address", async () => {
    const m = await olderMember();
    const attempts = getEnv("policy").LOGIN_MAX_ATTEMPTS;
    for (let i = 0; i < attempts; i++) await callRoute(reauth, { method: "POST", cookie: m.cookie, body: { token: WRONG }, ip: randomTestIp() });
    const locked = await callRoute(reauth, { method: "POST", cookie: m.cookie, body: { token: m.token }, ip: randomTestIp() });
    expect([locked.status, locked.json.code]).toEqual([429, "RATE_LIMITED"]);
    // Sign-in from a fresh address is not affected by the account's reauth lockout.
    const other = await member();
    expect((await callRoute(revealToken, { cookie: other.cookie })).status).toBe(200);
  });
});

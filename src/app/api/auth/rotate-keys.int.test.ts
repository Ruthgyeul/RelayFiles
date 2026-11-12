import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import type { SessionState } from "@/contracts/auth";
import { tokenKeys } from "@/server/auth/keys";
import { rotateAccountKeys } from "@/server/auth/rotate-keys";
import { encryptToken, tokenLookups, type TokenKeys } from "@/server/auth/token-crypto";
import { db } from "@/server/db/client";
import { restoreAccountTokenIf, touchAccountLoginIf } from "@/server/repositories/account.repo";
import { createAdminAccount, regenerateToken } from "@/server/services/auth.service";
import { callRoute } from "../../../../test/route-call";
import { randomTestIp } from "../../../../test/file-fixtures";

const accounts: string[] = [];

afterAll(async () => {
  await db().account.deleteMany({ where: { id: { in: accounts } } });
});

describe("key rotation", () => {
  it("re-encrypts tokens written with old keys so sign-in keeps working", async () => {
    const current = tokenKeys();
    const old: TokenKeys = { encKey: randomBytes(32), hmacKey: randomBytes(32).toString("hex") };
    const { account, token } = await createAdminAccount();
    accounts.push(account.id);
    // As if the account had been created before the keys changed.
    await db().account.update({ where: { id: account.id }, data: { tokenLookup: tokenLookups(token, old)[0]!, tokenEnc: new Uint8Array(encryptToken(token, old)) } });

    const rotating: TokenKeys = { ...current, previousEncKey: old.encKey, previousHmacKey: old.hmacKey };
    const result = await rotateAccountKeys(db(), rotating);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(result.unreadable).not.toContain(account.id);
    const row = await db().account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.tokenLookup).toBe(tokenLookups(token, current)[0]);

    // With the previous keys gone the token still signs in.
    const signedIn = await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() });
    expect(signedIn.status).toBe(200);
    expect((await rotateAccountKeys(db(), current)).updated).toBe(0);

    // A token under a key that is no longer configured is reported, not fatal.
    await db().account.update({ where: { id: account.id }, data: { tokenEnc: new Uint8Array(encryptToken(token, old)) } });
    expect((await rotateAccountKeys(db(), current)).unreadable).toContain(account.id);
  });

  it("never writes back or signs in with a token that was replaced after it was read", async () => {
    const keys = tokenKeys();
    const { account, token } = await createAdminAccount();
    accounts.push(account.id);
    const stale = tokenLookups(token, keys)[0]!;
    // "Generate a new token" lands between a rotation (or sign-in) reading the row and writing it.
    const { token: replacement } = await regenerateToken(account.id, "no-session");
    expect(await restoreAccountTokenIf(db(), account.id, stale, { tokenLookup: stale, tokenEnc: new Uint8Array(encryptToken(token, keys)) })).toBe(false);
    expect(await touchAccountLoginIf(db(), account.id, stale, new Date())).toBe(false);
    const row = await db().account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.tokenLookup).toBe(tokenLookups(replacement, keys)[0]);
    expect((await callRoute(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() })).status).toBe(401);
  });
});


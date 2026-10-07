import { afterAll, describe, expect, it } from "vitest";
import { DELETE as takeDown, POST as publish } from "@/app/api/admin/announcement/route";
import { DELETE as revoke } from "@/app/api/admin/invites/[code]/route";
import { POST as newInvite } from "@/app/api/admin/invites/route";
import { GET as settings } from "@/app/api/admin/settings/route";
import { PUT as signup } from "@/app/api/admin/settings/signup/route";
import { PUT as theme } from "@/app/api/admin/settings/theme/route";
import { POST as anonymous } from "@/app/api/auth/anonymous/route";
import { POST as tokenSignIn } from "@/app/api/auth/token/route";
import type { CreatedAccount, SessionState } from "@/contracts/auth";
import type { ServerSettings } from "@/contracts/server-settings";
import { db } from "@/server/db/client";
import { getServerConfig, updateServerConfig } from "@/server/repositories/server-config.repo";
import { createAdminAccount } from "@/server/services/auth.service";
import { currentAnnouncement, currentTheme, setTheme } from "@/server/services/server-settings.service";
import { callRoute } from "../../../../../test/route-call";
import { fileFixtures, randomTestIp } from "../../../../../test/file-fixtures";

const { cleanup } = fileFixtures();
/** Concurrent first requests per round, and rounds, for the settings-row race. */
const RACE_REQUESTS = 20;
const RACE_ROUNDS = 10;
const created: string[] = [];

afterAll(async () => {
  await db().serverConfig.update({ where: { id: 1 }, data: { signupMode: "OPEN" } });
  await setTheme(null);
  await db().account.deleteMany({ where: { id: { in: created } } });
  await cleanup();
});

async function admin() {
  const { account, token } = await createAdminAccount();
  created.push(account.id);
  return (await callRoute<SessionState>(tokenSignIn, { method: "POST", body: { token }, ip: randomTestIp() })).cookie!;
}

describe("server settings", () => {
  it("publishes and takes down the announcement", async () => {
    const cookie = await admin();
    expect((await callRoute(publish, { method: "POST", cookie, body: { text: "  Maintenance at 02:00  ", level: "maint" } })).status).toBe(200);
    expect(await currentAnnouncement()).toMatchObject({ text: "Maintenance at 02:00", level: "maint", live: true });
    expect((await callRoute(publish, { method: "POST", cookie, body: { text: "   ", level: "info" } })).status).toBe(400);

    await callRoute(takeDown, { method: "DELETE", cookie });
    expect(await currentAnnouncement()).toBeNull();
    const latest = (await callRoute<ServerSettings>(settings, { cookie })).json.data.announcement;
    expect(latest).toMatchObject({ text: "Maintenance at 02:00", live: false });
  });

  it("closes sign-ups or requires one-time invite codes", async () => {
    const cookie = await admin();
    await callRoute(signup, { method: "PUT", cookie, body: { mode: "closed" } });
    const closed = await callRoute(anonymous, { method: "POST", body: {}, ip: randomTestIp() });
    expect(closed.json.code).toBe("SIGNUP_CLOSED");

    await callRoute(signup, { method: "PUT", cookie, body: { mode: "invite" } });
    const code = (await callRoute<{ code: string }>(newInvite, { method: "POST", cookie })).json.data.code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const joined = await callRoute<CreatedAccount>(anonymous, { method: "POST", body: { inviteCode: code }, ip: randomTestIp() });
    expect(joined.status).toBe(201);
    created.push(joined.json.data.account.id);
    const reused = await callRoute(anonymous, { method: "POST", body: { inviteCode: code }, ip: randomTestIp() });
    expect(reused.json.code).toBe("INVALID_INVITE");

    const listed = (await callRoute<ServerSettings>(settings, { cookie })).json.data;
    expect(listed.signupMode).toBe("invite");
    expect(listed.invites.find((invite) => invite.code === code)?.usedBy).toBe(joined.json.data.account.name);
    // Used codes stay in the list and can't be revoked; unused ones can.
    expect((await callRoute(revoke, { method: "DELETE", cookie, params: { code } })).status).toBe(404);
    const spare = (await callRoute<{ code: string }>(newInvite, { method: "POST", cookie })).json.data.code;
    expect((await callRoute(revoke, { method: "DELETE", cookie, params: { code: spare } })).status).toBe(200);
    await callRoute(signup, { method: "PUT", cookie, body: { mode: "open" } });
  });

  it("sets the theme every page is rendered with", async () => {
    const cookie = await admin();
    expect((await callRoute(theme, { method: "PUT", cookie, body: { theme: "plum" } })).status).toBe(200);
    expect(await currentTheme()).toBe("plum");
    expect((await callRoute(theme, { method: "PUT", cookie, body: { theme: "neon" } })).status).toBe(400);
  });

  it("creates the settings row once when the first requests arrive together", async () => {
    const before = await getServerConfig(db());
    for (let round = 0; round < RACE_ROUNDS; round++) {
      await db().serverConfig.deleteMany({});
      const reads = Array.from({ length: RACE_REQUESTS }, () => getServerConfig(db()));
      const writes = [updateServerConfig(db(), { signupMode: before.signupMode }), updateServerConfig(db(), { theme: before.theme })];
      // Any request losing the race would reject here.
      await Promise.all([...reads, ...writes]);
      expect(await db().serverConfig.count()).toBe(1);
    }
    expect(await getServerConfig(db())).toEqual(before);
  });
});

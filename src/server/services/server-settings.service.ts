import "server-only";
import { randomUUID } from "node:crypto";
import { MS, SETTINGS } from "@/config/policy";
import { inviteStatus } from "@/domain/admin";
import { getAppEnv } from "@/config/env";
import { isThemeKey, type ThemeKey } from "@/config/theme";
import type { SignupMode } from "@/contracts/auth";
import type { AnnouncementDto, AnnouncementLevel, CreateInviteInput, ServerSettings } from "@/contracts/server-settings";
import { newInviteCode } from "@/domain/ids";
import { cached, invalidate } from "../cache/cached";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { latestAnnouncement, liveAnnouncement, publishAnnouncement, takeDownAnnouncements } from "../repositories/announcement.repo";
import { createInvite, getServerConfig, listInvites, revokeInvite, updateServerConfig } from "../repositories/server-config.repo";

/** The theme is read on every page render, so it is cached briefly. */
const THEME_CACHE_KEY = "settings:theme";

type AnnouncementRow = NonNullable<Awaited<ReturnType<typeof latestAnnouncement>>>;
const toAnnouncement = (row: AnnouncementRow): AnnouncementDto => ({
  id: row.id,
  text: row.text,
  level: row.level.toLowerCase() as AnnouncementLevel,
  live: row.live,
  at: row.at.toISOString(),
});

/** The theme chosen on the Server page, else DEFAULT_THEME. Never fails (error pages use it too). */
export async function currentTheme(): Promise<ThemeKey> {
  const fallback = getAppEnv().DEFAULT_THEME;
  try {
    const stored = await cached(THEME_CACHE_KEY, SETTINGS.themeCacheSec, async () => (await getServerConfig(db())).theme);
    return stored && isThemeKey(stored) ? stored : fallback;
  } catch (error) {
    logger.warn("theme not loaded, using the default", { error });
    return fallback;
  }
}

export async function serverSettings(now: number = Date.now()): Promise<ServerSettings> {
  const [config, announcement, invites] = await Promise.all([getServerConfig(db()), latestAnnouncement(db()), listInvites(db())]);
  return {
    signupMode: config.signupMode.toLowerCase() as SignupMode,
    theme: config.theme && isThemeKey(config.theme) ? config.theme : getAppEnv().DEFAULT_THEME,
    announcement: announcement ? toAnnouncement(announcement) : null,
    invites: invites.map((invite) => ({
      code: invite.code,
      createdAt: invite.createdAt.toISOString(),
      usedBy: invite.usedByName,
      uses: invite.uses,
      maxUses: invite.maxUses,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      status: inviteStatus({ uses: invite.uses, maxUses: invite.maxUses, expiresAt: invite.expiresAt?.getTime() ?? null }, now),
    })),
  };
}

/** The announcement every account sees on the File Manager, if one is live. */
export async function currentAnnouncement(): Promise<AnnouncementDto | null> {
  try {
    const row = await liveAnnouncement(db());
    return row ? toAnnouncement(row) : null;
  } catch (error) {
    logger.warn("announcement not loaded", { error });
    return null;
  }
}

export async function setSignupMode(mode: SignupMode): Promise<void> {
  await updateServerConfig(db(), { signupMode: mode.toUpperCase() as "OPEN" | "INVITE" | "CLOSED" });
}

/** Sets the server theme; null returns to DEFAULT_THEME. */
export async function setTheme(theme: ThemeKey | null): Promise<void> {
  await updateServerConfig(db(), { theme });
  await invalidate([THEME_CACHE_KEY]);
}

export async function announce(text: string, level: AnnouncementLevel): Promise<void> {
  await db().$transaction((tx) => publishAnnouncement(tx, { id: randomUUID(), text, level: level.toUpperCase() as "INFO" | "WARN" | "MAINT" }));
}

export async function takeDownAnnouncement(): Promise<void> {
  await takeDownAnnouncements(db());
}

/** A new invite code (XXXX-XXXX) for `maxUses` accounts, valid for `expiresInDays` (null: no expiry). */
export async function generateInvite(limits: CreateInviteInput, now: Date = new Date()): Promise<string> {
  const expiresAt = limits.expiresInDays === null ? null : new Date(now.getTime() + limits.expiresInDays * MS.day);
  // A code that is already taken is drawn again.
  return retryOnUniqueViolation(async () => {
    const code = newInviteCode();
    await createInvite(db(), code, { maxUses: limits.maxUses, expiresAt });
    return code;
  });
}

export async function revokeInviteCode(code: string): Promise<void> {
  if (!(await revokeInvite(db(), code, new Date()))) throw new ApiError("NOT_FOUND");
}

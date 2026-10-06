import "server-only";
import { randomUUID } from "node:crypto";
import { getAppEnv } from "@/config/env";
import { isThemeKey, type ThemeKey } from "@/config/theme";
import type { SignupMode } from "@/contracts/auth";
import type { AnnouncementDto, AnnouncementLevel, ServerSettings } from "@/contracts/server-settings";
import { newInviteCode } from "@/domain/ids";
import { cached, invalidate } from "../cache/cached";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { latestAnnouncement, liveAnnouncement, publishAnnouncement, takeDownAnnouncements } from "../repositories/announcement.repo";
import { createInvite, getServerConfig, listInvites, revokeInvite, updateServerConfig } from "../repositories/server-config.repo";

/** The theme is read on every page render, so it is cached briefly. */
const THEME_CACHE_KEY = "settings:theme";
const THEME_CACHE_SEC = 60;
const INVITE_ATTEMPTS = 5;

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
    const stored = await cached(THEME_CACHE_KEY, THEME_CACHE_SEC, async () => (await getServerConfig(db())).theme);
    return stored && isThemeKey(stored) ? stored : fallback;
  } catch (error) {
    logger.warn("theme not loaded, using the default", { error });
    return fallback;
  }
}

export async function serverSettings(): Promise<ServerSettings> {
  const [config, announcement, invites] = await Promise.all([getServerConfig(db()), latestAnnouncement(db()), listInvites(db())]);
  return {
    signupMode: config.signupMode.toLowerCase() as SignupMode,
    theme: config.theme && isThemeKey(config.theme) ? config.theme : getAppEnv().DEFAULT_THEME,
    announcement: announcement ? toAnnouncement(announcement) : null,
    invites: invites.map((invite) => ({ code: invite.code, createdAt: invite.createdAt.toISOString(), usedBy: invite.usedByName })),
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

/** A new one-time invite code (design `genInvite`, XXXX-XXXX). */
export async function generateInvite(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const code = newInviteCode();
    try {
      await createInvite(db(), code);
      return code;
    } catch (error) {
      const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!taken || attempt >= INVITE_ATTEMPTS) throw error;
    }
  }
}

export async function revokeInviteCode(code: string): Promise<void> {
  if (!(await revokeInvite(db(), code))) throw new ApiError("NOT_FOUND");
}

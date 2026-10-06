import { z } from "zod";
import { THEME_KEYS, type ThemeKey } from "@/config/theme";
import { SIGNUP_MODES, type SignupMode } from "./auth";

export const ANNOUNCEMENT_LEVELS = ["info", "warn", "maint"] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

/** The latest announcement (live or taken down). */
export interface AnnouncementDto {
  id: string;
  text: string;
  level: AnnouncementLevel;
  live: boolean;
  at: string;
}

export interface InviteDto {
  code: string;
  createdAt: string;
  /** Name of the account created with it, or null while unused. */
  usedBy: string | null;
}

/** Everything the Server page edits (metrics come from their own stream). */
export interface ServerSettings {
  signupMode: SignupMode;
  /** Theme key; the server's DEFAULT_THEME when not chosen here. */
  theme: ThemeKey;
  announcement: AnnouncementDto | null;
  invites: InviteDto[];
}

/** Longest announcement text. */
export const MAX_ANNOUNCEMENT_LENGTH = 1_000;

export const announcementSchema = z.object({ text: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_LENGTH), level: z.enum(ANNOUNCEMENT_LEVELS) });
export const signupModeSchema = z.object({ mode: z.enum(SIGNUP_MODES) });
export const themeSchema = z.object({ theme: z.enum(THEME_KEYS) });

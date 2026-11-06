import { z } from "zod";
import { INVITE } from "@/config/policy";
import { THEME_KEYS, type ThemeKey } from "@/config/theme";
import type { InviteStatus } from "@/domain/admin";
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
  /** Name of the last account created with it, or null while unused. */
  usedBy: string | null;
  uses: number;
  maxUses: number;
  /** ISO time it stops working, or null without an expiry date. */
  expiresAt: string | null;
  status: InviteStatus;
}

/** POST /api/admin/invites: how many accounts the code may create and for how many days (null: no expiry). */
export const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(INVITE.maxUses).default(1),
  expiresInDays: z.number().int().min(1).max(INVITE.maxExpiryDays).nullable().default(INVITE.defaultExpiryDays),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

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

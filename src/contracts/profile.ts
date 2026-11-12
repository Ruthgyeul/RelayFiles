import { z } from "zod";
import { SECURITY_LOG } from "@/config/policy";
import type { SecurityEvent } from "@/domain/security-log";
import type { ApiTokenDto } from "./api-tokens";

/** A device signed in to the account (design "Signed-in devices"). */
export interface DeviceDto {
  id: string;
  os: string;
  browser: string;
  /** "Seoul, KR", "KR" or "Local network". */
  location: string;
  /** a.b.•••.••• */
  ipMasked: string;
  lastSeenAt: string;
  current: boolean;
}

/** Everything the My Profile page shows for the active account. */
export interface ProfileData {
  account: {
    id: string;
    name: string;
    isAdmin: boolean;
    neverExpire: boolean;
    /** The admin set a deletion date. */
    extended: boolean;
    createdAt: string;
    lastLoginAt: string;
    deletesAt: string | null;
    quotaBytes: string | null;
    stripMetadataOnShare: boolean;
    /** Owner notifications about its share links (opened, downloads used up). */
    notifyLinkEvents: boolean;
  };
  /** The server sends owner notifications (NOTIFY_WEBHOOK_URL is set). */
  notifyAvailable: boolean;
  /** What shared photos and videos lose on this server (SHARE_METADATA_STRIP); "none" turns the account setting off. */
  shareStripMode: "sensitive" | "all" | "none";
  /** First 4 + 28 dots + last 4 characters; the full token is fetched on demand. */
  maskedToken: string;
  usage: { usedBytes: string; files: number; folders: number };
  /** Bytes served per day for the last 30 days, oldest first. */
  traffic: { total: string; days: string[] };
  devices: DeviceDto[];
  /** Personal API tokens (/api/v1), newest first. */
  apiTokens: ApiTokenDto[];
}

/** The preferences sent change; the others keep their values. */
export const preferencesSchema = z
  .object({ stripMetadataOnShare: z.boolean().optional(), notifyLinkEvents: z.boolean().optional() })
  .refine((input) => input.stripMetadataOnShare !== undefined || input.notifyLinkEvents !== undefined, "Send a preference.");
export type Preferences = z.infer<typeof preferencesSchema>;

/** One entry of the account's security log (GET /api/me/security-log). */
export interface SecurityLogEntry {
  id: string;
  kind: SecurityEvent;
  detail: string | null;
  os: string;
  browser: string;
  ipMasked: string;
  country: string | null;
  at: string;
}

/** GET /api/me/security-log query: newest first, `cursor` = the last entry id of the previous page. */
export const securityLogQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(SECURITY_LOG.listLimit).default(SECURITY_LOG.pageSize),
});
export type SecurityLogQuery = z.infer<typeof securityLogQuerySchema>;

/** One page of the security log; `nextCursor` is null on the last page. */
export interface SecurityLogPage {
  events: SecurityLogEntry[];
  nextCursor: string | null;
}

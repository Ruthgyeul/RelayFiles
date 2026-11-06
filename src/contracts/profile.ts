import { z } from "zod";
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

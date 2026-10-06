import { z } from "zod";

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
  };
  /** First 4 + 28 dots + last 4 characters; the full token is fetched on demand. */
  maskedToken: string;
  usage: { usedBytes: string; files: number; folders: number };
  /** Bytes served per day for the last 30 days, oldest first. */
  traffic: { total: string; days: string[] };
  devices: DeviceDto[];
}

export const preferencesSchema = z.object({ stripMetadataOnShare: z.boolean() });
export type Preferences = z.infer<typeof preferencesSchema>;

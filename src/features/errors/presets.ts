import type { ErrorPageCode } from "@/contracts/errors";
import type { Tone } from "@/shared/styles/palette";
import type { IconName } from "@/shared/ui/icon/Icon";

export interface ErrorPreset {
  /** Badge text, e.g. "404". */
  badge: string;
  icon: IconName;
  /** 4xx = danger, 5xx and maintenance = warn, informational = accent (docs/plan.md §9.1). */
  tone: Tone;
  title: string;
  description: string;
}

export const ERROR_PRESETS: Record<ErrorPageCode, ErrorPreset> = {
  "400": { badge: "400", icon: "warning-octagon", tone: "danger", title: "Bad request", description: "The link or request is malformed." },
  "401": { badge: "401", icon: "key", tone: "accent", title: "Sign in required", description: "This page needs an account token." },
  "403": { badge: "403", icon: "shield-warning", tone: "danger", title: "Access denied", description: "Your account can't open this page." },
  "404": { badge: "404", icon: "file-x", tone: "danger", title: "Page not found", description: "This page doesn't exist or was moved." },
  "410": {
    badge: "410",
    icon: "hourglass-simple-low",
    tone: "danger",
    title: "Account deleted",
    description: "This account reached its deletion date and its files were removed.",
  },
  "429": { badge: "429", icon: "timer", tone: "danger", title: "Too many requests", description: "Please wait before trying again." },
  "500": {
    badge: "500",
    icon: "bug",
    tone: "warn",
    title: "Something went wrong",
    description: "An unexpected error occurred. It has been logged.",
  },
  "503": {
    badge: "503",
    icon: "wrench",
    tone: "warn",
    title: "Under maintenance",
    description: "The server is being updated. Please check back soon.",
  },
  "storage-offline": {
    badge: "503",
    icon: "hard-drives",
    tone: "warn",
    title: "Storage offline",
    description: "Files are temporarily unavailable. Browsing still works; uploads and downloads resume when storage is back.",
  },
};

/** Formats seconds as m:ss for the 429 countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

import "server-only";
import type { DbClient } from "../db/client";

const SELECT = { id: true, text: true, level: true, live: true, at: true } as const;

/** The most recent announcement, live or not (the editor starts from it). */
export function latestAnnouncement(db: DbClient) {
  return db.announcement.findFirst({ orderBy: { at: "desc" }, select: SELECT });
}

/** The announcement shown to every account, if any. */
export function liveAnnouncement(db: DbClient) {
  return db.announcement.findFirst({ where: { live: true }, orderBy: { at: "desc" }, select: SELECT });
}

/** Publishes a new announcement; earlier ones stop showing. */
export async function publishAnnouncement(db: DbClient, data: { id: string; text: string; level: "INFO" | "WARN" | "MAINT" }): Promise<void> {
  await db.announcement.updateMany({ where: { live: true }, data: { live: false } });
  await db.announcement.create({ data: { ...data, live: true } });
}

export async function takeDownAnnouncements(db: DbClient): Promise<void> {
  await db.announcement.updateMany({ where: { live: true }, data: { live: false } });
}

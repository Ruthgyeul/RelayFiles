import "server-only";
import type { DbClient } from "../db/client";

export type IncidentRow = Awaited<ReturnType<typeof recentIncidents>>[number];
type IncidentData = { title: string; text: string; severity: "MINOR" | "MAJOR" | "MAINT"; date: Date; duration: string; resolved: boolean };

const SELECT = { id: true, title: true, text: true, severity: true, date: true, duration: true, resolved: true } as const;

/** Newest first (by the day it happened, then when it was posted). */
export function recentIncidents(db: DbClient, take: number) {
  return db.incident.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take, select: SELECT });
}

export async function createIncident(db: DbClient, id: string, data: IncidentData): Promise<void> {
  await db.incident.create({ data: { id, ...data } });
}

/** False when the incident doesn't exist. */
export async function updateIncident(db: DbClient, id: string, data: IncidentData): Promise<boolean> {
  return (await db.incident.updateMany({ where: { id }, data })).count === 1;
}

export async function deleteIncident(db: DbClient, id: string): Promise<boolean> {
  return (await db.incident.deleteMany({ where: { id } })).count === 1;
}

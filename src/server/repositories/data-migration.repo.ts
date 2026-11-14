import "server-only";
import type { DbClient } from "../db/client";

/** Run record of one data migration (src/server/migrations): its saved cursor and when it finished. */
export function dataMigrationRecord(db: DbClient, id: string) {
  return db.dataMigration.findUnique({ where: { id }, select: { cursor: true, finishedAt: true } });
}

export async function startDataMigration(db: DbClient, id: string): Promise<void> {
  await db.dataMigration.create({ data: { id } });
}

export async function saveDataMigrationCursor(db: DbClient, id: string, cursor: string): Promise<void> {
  await db.dataMigration.update({ where: { id }, data: { cursor } });
}

export async function finishDataMigration(db: DbClient, id: string, at: Date): Promise<void> {
  await db.dataMigration.update({ where: { id }, data: { finishedAt: at } });
}

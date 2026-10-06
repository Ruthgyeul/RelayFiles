/**
 * Prepares the storage volume at STORAGE_ROOT and registers it in the database.
 * Run once after mounting a new (empty) SSD: npm run volume:init
 * Safe to re-run: an already initialised volume is only (re)registered.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { getEnv } = await import("../src/config/env");
const { db } = await import("../src/server/db/client");
const { initVolume, readVolumeMarker } = await import("../src/server/storage/volume");

const storage = getEnv("storage");
const root = resolve(storage.STORAGE_ROOT);
await mkdir(root, { recursive: true });

const marker = (await readVolumeMarker(root)) ?? (await initVolume(root, randomUUID()));
await db().storageVolume.upsert({
  where: { id: marker.volumeId },
  create: { id: marker.volumeId, mountPath: root, layoutVersion: marker.layoutVersion, reservePct: Math.round(storage.STORAGE_RESERVE_PERCENT) },
  update: { mountPath: root, status: "ACTIVE" },
});

console.log(`Volume ${marker.volumeId} ready at ${root} (layout v${marker.layoutVersion}).`);
await db().$disconnect();

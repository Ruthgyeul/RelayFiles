/**
 * Prepares a storage volume and registers it in the database.
 *   npm run volume:init                       the main volume at STORAGE_ROOT
 *   npm run volume:init -- /mnt/relayfilesDB2 an additional SSD (also writes its Nginx location)
 * Safe to re-run: an already initialised volume is only (re)registered.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { getEnv } = await import("../src/config/env");
const { db } = await import("../src/server/db/client");
const { initVolume, readVolumeMarker } = await import("../src/server/storage/volume");

const storage = getEnv("storage");
const root = resolve(process.argv[2] ?? storage.STORAGE_ROOT);
await mkdir(root, { recursive: true });

const marker = (await readVolumeMarker(root)) ?? (await initVolume(root, randomUUID()));
const existing = await db().storageVolume.findUnique({ where: { id: marker.volumeId }, select: { status: true } });
await db().storageVolume.upsert({
  where: { id: marker.volumeId },
  create: { id: marker.volumeId, mountPath: root, layoutVersion: marker.layoutVersion, reservePct: Math.round(storage.STORAGE_RESERVE_PERCENT) },
  // A remount brings an OFFLINE volume back; READONLY and DRAINING belong to a running migration.
  update: { mountPath: root, ...(existing?.status === "OFFLINE" ? { status: "ACTIVE" as const } : {}) },
});

console.log(`Volume ${marker.volumeId} ready at ${root} (layout v${marker.layoutVersion}).`);

// Volumes other than STORAGE_ROOT need their own X-Accel location in Nginx.
if (root !== resolve(storage.STORAGE_ROOT)) {
  const prefix = storage.STORAGE_ACCEL_PREFIX;
  const name = `deploy/nginx/volumes/${marker.volumeId}.conf`;
  const location =
    `# ${root} (volume ${marker.volumeId}), written by npm run volume:init\n` +
    `location ~ ^${prefix}${marker.volumeId}/(.+)$ {\n    internal;\n    alias ${root}/users/$1;\n` +
    `    add_header X-Content-Type-Options nosniff always;\n    add_header Cache-Control "private, no-cache" always;\n}\n`;
  try {
    await writeFile(new URL(`../${name}`, import.meta.url), location);
    console.log(`Nginx location written to ${name}.`);
  } catch {
    // The tools container may not be allowed to write the repository; print it instead.
    console.log(`Save the following as ${name}:\n\n${location}`);
  }
  console.log(`Mount ${root} into app, worker, tools and nginx (deploy/docker-compose.volumes.yml), then restart them.`);
}
await db().$disconnect();

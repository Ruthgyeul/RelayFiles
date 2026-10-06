/**
 * Unregisters a drained volume (npm run volume:remove -- <volumeId>). Only a DRAINING volume
 * without accounts can be removed; the files on the disk are left alone, so wipe or unplug the
 * SSD afterwards and delete its deploy/nginx/volumes/<volumeId>.conf.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { db } = await import("../src/server/db/client");

const volumeId = process.argv[2];
try {
  if (!volumeId) throw new Error("Usage: npm run volume:remove -- <volumeId> (see npm run volume:list)");
  const volume = await db().storageVolume.findUnique({ where: { id: volumeId }, include: { _count: { select: { accounts: true } } } });
  if (!volume) throw new Error(`Volume ${volumeId} is not registered.`);
  if (volume.status !== "DRAINING") throw new Error(`Volume ${volumeId} is ${volume.status}; drain it first: npm run volume:migrate -- --volume ${volumeId}`);
  if (volume._count.accounts > 0) throw new Error(`Volume ${volumeId} still holds ${volume._count.accounts} account(s); run the drain again.`);
  await db().storageVolume.delete({ where: { id: volumeId } });
  console.log(`Volume ${volumeId} (${volume.mountPath}) removed. Its files were not touched.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db().$disconnect();
}

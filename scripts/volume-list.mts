/** Lists registered storage volumes with their status, layout, accounts and free space (npm run volume:list). */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { db } = await import("../src/server/db/client");
const { checkVolume } = await import("../src/server/storage/volume");
const { driverFor } = await import("../src/server/storage/registry");
const { formatSize } = await import("../src/domain/format");

const volumes = await db().storageVolume.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { accounts: true } } } });
for (const volume of volumes) {
  const state = await checkVolume(volume.mountPath, volume.id);
  const space = state.state === "online" && volume.status !== "OFFLINE" ? await driverFor(volume).space() : null;
  console.log(
    [
      volume.id,
      volume.mountPath,
      volume.status,
      `layout ${volume.layoutVersion}`,
      state.state,
      `${volume._count.accounts} accounts`,
      space ? `${formatSize(Number(space.available))} free of ${formatSize(Number(space.total))}` : "",
    ].join("  "),
  );
}
await db().$disconnect();

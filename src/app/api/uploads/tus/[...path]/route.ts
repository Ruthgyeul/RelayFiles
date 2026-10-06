import { ERRORS } from "@/contracts/errors";
import { db } from "@/server/db/client";
import { findVolume } from "@/server/repositories/volume.repo";
import { tusServerFor } from "@/server/upload/tus";

/**
 * tus resumable uploads: /api/uploads/tus/<volumeId>[/<uploadId>]. This path is excluded
 * from proxy.ts so request bodies stream instead of being buffered.
 */
async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const [volumeId] = (await params).path;
  const volume = volumeId ? await findVolume(db(), volumeId) : null;
  if (!volume || volume.status === "OFFLINE") return new Response(ERRORS.STORAGE_OFFLINE.message, { status: ERRORS.STORAGE_OFFLINE.status });
  return tusServerFor(volume).handleWeb(req);
}

export { handle as DELETE, handle as HEAD, handle as OPTIONS, handle as PATCH, handle as POST };

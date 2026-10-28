import { ERRORS } from "@/contracts/errors";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { findVolume } from "@/server/repositories/volume.repo";
import { tusServerFor } from "@/server/upload/tus";

/**
 * tus resumable uploads: /api/uploads/tus/<volumeId>[/<uploadId>]. This path is excluded
 * from proxy.ts so request bodies stream instead of being buffered, and it does not use
 * apiHandler: tus answers in its own plain-text protocol (errors are masked the same way).
 */
async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const [volumeId] = (await params).path;
    const volume = volumeId ? await findVolume(db(), volumeId) : null;
    if (!volume || volume.status === "OFFLINE") return new Response(ERRORS.STORAGE_OFFLINE.message, { status: ERRORS.STORAGE_OFFLINE.status });
    return await tusServerFor(volume).handleWeb(req);
  } catch (error) {
    // tus speaks plain text; like apiHandler, nothing internal reaches the client.
    logger.error("upload request failed", { error });
    return new Response(ERRORS.INTERNAL.message, { status: ERRORS.INTERNAL.status });
  }
}

export { handle as DELETE, handle as HEAD, handle as OPTIONS, handle as PATCH, handle as POST };

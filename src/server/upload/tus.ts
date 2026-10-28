import "server-only";
import { BYTES_PER_GB } from "@/domain/quota";
import { FileStore } from "@tus/file-store";
import { EVENTS, Server, type Upload } from "@tus/server";
import { getEnv } from "@/config/env";
import { ERRORS } from "@/contracts/errors";
import { UPLOAD_METADATA } from "@/contracts/uploads";
import { deviceOfRequest } from "../auth/current";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { layoutOf } from "../storage/layout";
import { releaseSpace } from "../services/space.service";
import { checkUploadStart, finalizeUpload } from "../services/upload.service";
import { forgetUpload, loadBatch, setUploadOwner, uploadOwner } from "./batches";
import { RedisLocker } from "./redis-locker";
import { markActive } from "../metrics/activity";


/** Error object the tus server turns into a response. */
function tusError(code: keyof typeof ERRORS, message: string = ERRORS[code].message) {
  return { status_code: ERRORS[code].status, body: message };
}

function rethrow(error: unknown): never {
  if (error instanceof ApiError) throw tusError(error.code, error.message);
  throw error;
}

/** The signed-in account on this device that owns `accountId`'s uploads, or a 404. */
async function ownerOn(req: Request, accountId: string | null) {
  const device = await deviceOfRequest(req);
  const owner = device.accounts.find((entry) => entry.account.id === accountId)?.account;
  if (!owner) throw tusError("NOT_FOUND");
  return owner;
}

function slotOf(upload: Upload): { batchId: string; slot: number } {
  const batchId = upload.metadata?.[UPLOAD_METADATA.batch] ?? "";
  const slot = Number(upload.metadata?.[UPLOAD_METADATA.index]);
  if (!batchId || !Number.isInteger(slot) || slot < 0) throw tusError("BAD_REQUEST");
  return { batchId, slot };
}

/** Upload locks shared by every app process (one locker for all volumes' servers). */
const locker = new RedisLocker();

function createServer(volumeId: string, mountPath: string): Server {
  const maxGb = getEnv("uploads").UPLOAD_MAX_FILE_SIZE_GB;
  return new Server({
    path: `/api/uploads/tus/${volumeId}`,
    datastore: new FileStore({ directory: layoutOf(mountPath).uploads }),
    locker,
    maxSize: maxGb ? Math.round(maxGb * BYTES_PER_GB) : undefined,
    relativeLocation: true,
    respectForwardedHeaders: true,
    // Uploads come from this site's own pages; other origins get no CORS headers (default: any).
    allowedOrigins: [new URL(getEnv("app").PUBLIC_URL).origin],
    async onUploadCreate(req, upload) {
      const { batchId, slot } = slotOf(upload);
      const batch = await loadBatch(batchId);
      const owner = await ownerOn(req, batch?.accountId ?? null);
      await checkUploadStart(owner, batchId, slot, upload.size, volumeId, upload.id).catch(rethrow);
      await setUploadOwner(upload.id, owner.id);
      return {};
    },
    async onIncomingRequest(req, uploadId) {
      // Only the uploader may continue, query or cancel an upload.
      if (req.method === "POST" || req.method === "OPTIONS") return;
      await ownerOn(req, await uploadOwner(uploadId));
      if (req.method === "PATCH") void markActive("upload", uploadId);
    },
    async onUploadFinish(req, upload) {
      const { batchId, slot } = slotOf(upload);
      const batch = await loadBatch(batchId);
      if (!batch) throw tusError("NOT_FOUND", "This upload has expired. Start it again.");
      const owner = await ownerOn(req, batch.accountId);
      try {
        const file = await finalizeUpload(owner, batch, slot, upload.id).catch(rethrow);
        await forgetUpload(upload.id);
        return { status_code: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ success: true, data: file }) };
      } finally {
        // Placed (its bytes now count as used) or refused (its chunks are removed): either way no longer pending.
        await releaseSpace(upload.id, owner.id, volumeId).catch((error: unknown) => logger.warn("upload reservation not released", { error }));
      }
    },
    onResponseError(_req, error) {
      if ("status_code" in error) return error;
      logger.error("upload failed", { error });
      return { status_code: ERRORS.INTERNAL.status, body: ERRORS.INTERNAL.message };
    },
  });
}

/** A cancelled upload (tus DELETE) gives its reserved space back. */
function releaseOnTerminate(server: Server, volumeId: string): Server {
  server.on(EVENTS.POST_TERMINATE, (_req, _res, uploadId: string) => {
    void (async () => {
      const accountId = await uploadOwner(uploadId);
      if (accountId) await releaseSpace(uploadId, accountId, volumeId);
      await forgetUpload(uploadId);
    })().catch((error: unknown) => logger.warn("upload reservation not released", { error }));
  });
  return server;
}

const servers = new Map<string, { mountPath: string; server: Server }>();

/**
 * One tus server per storage volume; chunks land in that volume's upload area. Like the
 * storage driver, a volume registered again at another path gets a new server for it.
 */
export function tusServerFor(volume: { id: string; mountPath: string }): Server {
  const existing = servers.get(volume.id);
  if (existing?.mountPath === volume.mountPath) return existing.server;
  const server = releaseOnTerminate(createServer(volume.id, volume.mountPath), volume.id);
  servers.set(volume.id, { mountPath: volume.mountPath, server });
  return server;
}

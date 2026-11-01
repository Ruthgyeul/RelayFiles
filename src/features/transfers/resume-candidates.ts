/** What tus-js-client keeps in localStorage about an upload this device started. */
export interface StoredUpload {
  size: number | null;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
}

export interface ResumeCandidate<T extends StoredUpload> {
  stored: T;
  uploadId: string;
}

/** Any base works: only the path of the stored (absolute) upload URL is compared. */
const URL_BASE = "http://localhost";
const UPLOAD_ID = /^[0-9a-f]{32}$/;

/** The tus upload id of `uploadUrl` when it lies directly below `endpoint` (the batch's volume), else null. */
export function uploadIdIn(uploadUrl: string | null, endpoint: string): string | null {
  if (!uploadUrl) return null;
  let path: string;
  try {
    path = new URL(uploadUrl, URL_BASE).pathname;
  } catch {
    return null;
  }
  const base = new URL(endpoint, URL_BASE).pathname.replace(/\/$/, "");
  if (!path.startsWith(`${base}/`)) return null;
  const id = path.slice(base.length + 1);
  return UPLOAD_ID.test(id) ? id : null;
}

/**
 * Earlier uploads of the same file worth asking the server to continue: same size, same
 * endpoint, not already taken by another file of this batch; newest first, at most `max`.
 */
export function resumeCandidates<T extends StoredUpload>(stored: readonly T[], size: number, endpoint: string, taken: ReadonlySet<string>, max: number): ResumeCandidate<T>[] {
  const createdAt = (entry: T) => Date.parse(entry.creationTime) || 0;
  return stored
    .filter((entry) => entry.size === size)
    .map((entry) => ({ stored: entry, uploadId: uploadIdIn(entry.uploadUrl, endpoint) }))
    .filter((entry): entry is ResumeCandidate<T> => entry.uploadId !== null && !taken.has(entry.uploadId))
    .sort((a, b) => createdAt(b.stored) - createdAt(a.stored))
    .slice(0, max);
}

/** Transfers still sending or paused: leaving the page would lose them. */
export function hasUnfinishedUploads(transfers: readonly { direction: string; status: string }[]): boolean {
  return transfers.some((transfer) => transfer.direction === "up" && (transfer.status === "active" || transfer.status === "paused"));
}

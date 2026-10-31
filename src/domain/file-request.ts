/** Rules of upload-only links (file requests). */

export type FileRequestStatus = "open" | "expired" | "full";

export interface RequestLimits {
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null;
  maxFiles: number | null;
  maxBytes: bigint | null;
  filesReceived: number;
  bytesReceived: bigint;
}

/** Files and bytes the request may still receive (null: no limit of its own). */
export function requestRoom(limits: RequestLimits): { files: number | null; bytes: bigint | null } {
  return {
    files: limits.maxFiles === null ? null : Math.max(0, limits.maxFiles - limits.filesReceived),
    bytes: limits.maxBytes === null ? null : limits.maxBytes > limits.bytesReceived ? limits.maxBytes - limits.bytesReceived : 0n,
  };
}

/** Expired once its date passed (or the owner's account reached its deletion date); full once a limit is used up. */
export function fileRequestStatus(limits: RequestLimits, accountExpired: boolean, now: number): FileRequestStatus {
  if (accountExpired || (limits.expiresAt !== null && limits.expiresAt <= now)) return "expired";
  const room = requestRoom(limits);
  return room.files === 0 || room.bytes === 0n ? "full" : "open";
}

/** Why a visitor batch does not fit the room left, or null when it does. */
export function requestBatchError(room: { files: number | null; bytes: bigint | null }, files: readonly { size: number }[], formatSize: (bytes: number) => string): string | null {
  if (room.files !== null && files.length > room.files) return `This link accepts ${room.files} more ${room.files === 1 ? "file" : "files"}.`;
  const total = files.reduce((sum, file) => sum + BigInt(file.size), 0n);
  if (room.bytes !== null && total > room.bytes) return `This link accepts ${formatSize(Number(room.bytes))} more.`;
  return null;
}

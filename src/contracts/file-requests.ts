import { z } from "zod";
import { FILE_REQUEST } from "@/config/policy";
import { MAX_NAME_BYTES } from "@/domain/names";
import { MAX_SHARE_PASSWORD_LENGTH } from "@/domain/share";
import type { FileRequestStatus } from "@/domain/file-request";
import { folderRefSchema } from "./nodes";

export const fileRequestIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

/** POST /api/file-requests: an upload-only link to one of the account's folders. */
export const createFileRequestSchema = z.object({
  folderId: folderRefSchema,
  title: z.string().trim().min(1).max(FILE_REQUEST.titleMaxLength),
  /** Null: anyone with the link can upload. */
  password: z.string().min(1).max(MAX_SHARE_PASSWORD_LENGTH).nullable(),
  /** One of FILE_REQUEST.expiryDays, or null for a link that stays open until deleted. */
  expiresInDays: z
    .number()
    .int()
    .refine((days) => (FILE_REQUEST.expiryDays as readonly number[]).includes(days), "Unknown lifetime.")
    .nullable(),
  maxFiles: z.number().int().positive().max(FILE_REQUEST.maxFilesLimit).nullable(),
  /** Total size of everything received, in MB; null = only the account quota applies. */
  maxMb: z.number().int().positive().nullable(),
});
export type CreateFileRequestInput = z.infer<typeof createFileRequestSchema>;

/** A request as its owner sees it. */
export interface FileRequestDto {
  id: string;
  url: string;
  title: string;
  folderId: string;
  hasPassword: boolean;
  status: FileRequestStatus;
  createdAt: string;
  expiresAt: string | null;
  maxFiles: number | null;
  /** Bytes as decimal strings. */
  maxBytes: string | null;
  filesReceived: number;
  bytesReceived: string;
}

/** What a visitor of /r/<id> learns: never the folder, its name or its contents. */
export interface FileRequestView {
  id: string;
  status: FileRequestStatus | "locked";
  title: string;
  ownerName: string;
  /** Room left under the request's own limits (null: no limit). */
  filesLeft: number | null;
  bytesLeft: string | null;
  /** UPLOAD_MAX_FILE_SIZE_GB in bytes, or null. */
  maxFileBytes: string | null;
}

/** POST /api/r/:id/uploads: the files a visitor is about to send (names only, no folders). */
export const requestUploadSchema = z.object({
  files: z
    .array(z.object({ name: z.string().min(1).max(MAX_NAME_BYTES), size: z.number().int().nonnegative() }))
    .min(1)
    .max(FILE_REQUEST.maxFilesPerBatch),
});
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

/** The tus batch for a visitor upload; files are sent in this order (slot = position). */
export interface RequestUploadPlan {
  batchId: string;
  endpoint: string;
}

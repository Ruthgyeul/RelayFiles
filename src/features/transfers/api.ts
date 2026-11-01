import type { ResumedUpload, ResumeUploadInput } from "@/contracts/uploads";
import { apiFetch } from "@/shared/lib/api-client";

/**
 * Asks the server to continue an earlier unfinished upload as file `slot` of a new batch.
 * Any refusal (404: finished, expired, changed or not this account's) means "send it again".
 */
export async function claimUpload(batchId: string, slot: number, uploadId: string): Promise<boolean> {
  const input: ResumeUploadInput = { batchId, slot, uploadId };
  try {
    await apiFetch<ResumedUpload>("/api/uploads/resume", { method: "POST", json: input });
    return true;
  } catch {
    return false;
  }
}

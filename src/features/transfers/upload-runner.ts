import { defaultOptions, DetailedError, Upload, type UploadOptions } from "tus-js-client";
import { UPLOAD } from "@/config/policy";
import { UPLOAD_METADATA } from "@/contracts/uploads";
import { resumeCandidates } from "./resume-candidates";

export interface BatchPlan {
  batchId: string;
  endpoint: string;
}

export interface RunnerEvents {
  /** Bytes sent so far across the batch (finished files plus the current one). */
  onProgress: (done: number) => void;
  /** Every file was sent, cancelled or (with `continueOnError`) failed; `failed` counts the last. */
  onComplete: (failed: number, firstError?: string) => void;
  /** The batch stopped on a failed file (without `continueOnError`). */
  onError: (message: string) => void;
}

/** Per-file events for the transfer card's file list (all optional). */
export interface FileEvents {
  onFileStart?: (slot: number) => void;
  onFileProgress?: (slot: number, sent: number) => void;
  onFileDone?: (slot: number) => void;
  onFileFailed?: (slot: number, message: string) => void;
  onFileCancelled?: (slot: number) => void;
}

/** Continuing uploads a reload interrupted (signed-in uploads; upload-only links start over). */
export interface ResumeOptions {
  /** Keeps one account's stored uploads apart from another's on a shared device (the account id). */
  scope: string;
  /** Asks the server to hand an earlier unfinished upload to this batch's file `slot`; false when it can't. */
  claim: (batchId: string, slot: number, uploadId: string) => Promise<boolean>;
}

export interface RunnerOptions {
  /** A failed file is reported and the next one starts, instead of stopping the batch. */
  continueOnError?: boolean;
  resume?: ResumeOptions;
}

/** Waits before retrying a failed chunk (connection drops); 4xx answers are not retried. */
const RETRY_DELAYS_MS = [0, 1_000, 3_000, 5_000, 10_000];
const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVER_ERROR = 500;
/** Statuses tus treats as temporary (offset conflict, locked). */
const RETRYABLE_CLIENT_STATUSES = new Set([409, 423]);

function statusOf(error: Error): number | null {
  return error instanceof DetailedError ? (error.originalResponse?.getStatus() ?? null) : null;
}

/** Client-safe message from a tus error (the server answers with a plain message body). */
function messageOf(error: Error): string {
  if (error instanceof DetailedError) {
    const status = error.originalResponse?.getStatus() ?? 0;
    const body = error.originalResponse?.getBody()?.trim();
    if (status >= HTTP_CLIENT_ERROR && body && body.length < 300 && !body.startsWith("<")) return body;
    if (!error.originalResponse) return "Connection lost";
  }
  return "Upload failed";
}

/**
 * Sends the files of one upload batch through tus, one after another, so a batch can be
 * paused, resumed from the server's offset, or cancelled as a unit or file by file.
 */
export class BatchUploader {
  private index = 0;
  private sentBefore = 0;
  private current: Upload | null = null;
  private paused = false;
  private cancelled = false;
  /** Slots cancelled before they started. */
  private readonly skipped = new Set<number>();
  private failed = 0;
  private firstError: string | undefined;
  /** The current upload once it was decided whether it continues an earlier one (it may then start). */
  private settled: Upload | null = null;
  /** Earlier uploads this batch already continues (two equal files must not share one). */
  private readonly claimed = new Set<string>();

  constructor(
    private readonly plan: BatchPlan,
    private readonly files: File[],
    private readonly chunkSize: number,
    private readonly events: RunnerEvents & FileEvents,
    private readonly options: RunnerOptions = {},
  ) {}

  start(): void {
    this.paused = false;
    this.next();
  }

  pause(): void {
    this.paused = true;
    void this.current?.abort();
  }

  resume(): void {
    if (!this.paused || this.cancelled) return;
    this.paused = false;
    if (!this.current) this.next();
    // Still being decided: it starts once that is done.
    else if (this.current === this.settled) this.current.start();
  }

  /** Stops the batch and asks the server to discard the unfinished file. */
  cancel(): void {
    this.cancelled = true;
    void this.current?.abort(true).catch(() => undefined);
  }

  /**
   * Cancels one file: one not started yet is skipped; the one being sent is discarded on the
   * server (tus DELETE gives its reserved space back) and the next one starts. A finished file
   * stays (false).
   */
  cancelFile(slot: number): boolean {
    if (this.cancelled || slot < this.index || slot >= this.files.length || this.skipped.has(slot)) return false;
    if (slot > this.index) {
      this.skipped.add(slot);
      this.events.onFileCancelled?.(slot);
      return true;
    }
    const upload = this.current;
    this.current = null;
    this.index += 1;
    this.events.onFileCancelled?.(slot);
    this.events.onProgress(this.sentBefore);
    void upload?.abort(true).catch(() => undefined);
    this.next();
    return true;
  }

  private next(): void {
    if (this.paused || this.cancelled) return;
    while (this.skipped.has(this.index)) this.index += 1;
    const file = this.files[this.index];
    if (!file) {
      this.events.onComplete(this.failed, this.firstError);
      return;
    }
    const slot = this.index;
    this.events.onFileStart?.(slot);
    const upload = new Upload(file, {
      endpoint: this.plan.endpoint,
      chunkSize: this.chunkSize,
      retryDelays: RETRY_DELAYS_MS,
      removeFingerprintOnSuccess: true,
      // Stored in localStorage only where a later batch may continue it.
      storeFingerprintForResuming: this.options.resume !== undefined,
      ...this.fingerprintOption(),
      metadata: {
        [UPLOAD_METADATA.batch]: this.plan.batchId,
        [UPLOAD_METADATA.index]: String(slot),
        [UPLOAD_METADATA.filename]: file.name,
        [UPLOAD_METADATA.lastModified]: String(file.lastModified),
      },
      onShouldRetry: (error) => {
        const status = statusOf(error);
        return status === null || status >= HTTP_SERVER_ERROR || RETRYABLE_CLIENT_STATUSES.has(status);
      },
      onProgress: (sent) => {
        if (this.current !== upload) return;
        this.events.onFileProgress?.(slot, sent);
        this.events.onProgress(this.sentBefore + sent);
      },
      onSuccess: () => {
        if (this.current !== upload) return;
        this.sentBefore += file.size;
        this.index += 1;
        this.current = null;
        this.events.onFileDone?.(slot);
        this.events.onProgress(this.sentBefore);
        this.next();
      },
      onError: (error) => {
        if (this.paused || this.cancelled || this.current !== upload) return;
        const message = messageOf(error);
        if (!this.options.continueOnError) return this.events.onError(message);
        this.failed += 1;
        this.firstError ??= message;
        this.index += 1;
        this.current = null;
        this.events.onFileFailed?.(slot, message);
        this.next();
      },
    });
    this.current = upload;
    void this.settle(upload, file, slot);
  }

  private fingerprintOption(): Pick<UploadOptions, "fingerprint"> {
    const scope = this.options.resume?.scope;
    if (!scope) return {};
    return { fingerprint: async (file, options) => `${await defaultOptions.fingerprint(file, options)}-${scope}` };
  }

  /**
   * Continues an earlier unfinished upload of the same file when the server hands it to this
   * slot (the page was reloaded mid-upload), then starts. Stored uploads the server refuses
   * (finished, expired, changed) are forgotten.
   */
  private async settle(upload: Upload, file: File, slot: number): Promise<void> {
    const resume = this.options.resume;
    if (resume) {
      try {
        const stored = await upload.findPreviousUploads();
        for (const candidate of resumeCandidates(stored, file.size, this.plan.endpoint, this.claimed, UPLOAD.resumeCandidates)) {
          if (this.current !== upload || this.cancelled) return;
          if (await resume.claim(this.plan.batchId, slot, candidate.uploadId)) {
            this.claimed.add(candidate.uploadId);
            upload.resumeFromPreviousUpload(candidate.stored);
            break;
          }
          await defaultOptions.urlStorage.removeUpload(candidate.stored.urlStorageKey);
        }
      } catch {
        // Storage blocked or the server unreachable: send the file from the start.
      }
    }
    if (this.current !== upload || this.cancelled) return;
    this.settled = upload;
    if (!this.paused) upload.start();
  }
}

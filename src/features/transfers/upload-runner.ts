import { DetailedError, Upload } from "tus-js-client";
import { UPLOAD_METADATA } from "@/contracts/uploads";

export interface BatchPlan {
  batchId: string;
  endpoint: string;
}

export interface RunnerEvents {
  /** Bytes sent so far across the batch. */
  onProgress: (done: number) => void;
  onComplete: () => void;
  onError: (message: string) => void;
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
 * paused, resumed from the server's offset, or cancelled as a unit.
 */
export class BatchUploader {
  private index = 0;
  private sentBefore = 0;
  private current: Upload | null = null;
  private paused = false;
  private cancelled = false;

  constructor(
    private readonly plan: BatchPlan,
    private readonly files: File[],
    private readonly chunkSize: number,
    private readonly events: RunnerEvents,
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
    if (this.current) this.current.start();
    else this.next();
  }

  /** Stops the batch and asks the server to discard the unfinished file. */
  cancel(): void {
    this.cancelled = true;
    void this.current?.abort(true).catch(() => undefined);
  }

  private next(): void {
    if (this.paused || this.cancelled) return;
    const file = this.files[this.index];
    if (!file) {
      this.events.onComplete();
      return;
    }
    const slot = this.index;
    const upload = new Upload(file, {
      endpoint: this.plan.endpoint,
      chunkSize: this.chunkSize,
      retryDelays: RETRY_DELAYS_MS,
      removeFingerprintOnSuccess: true,
      metadata: { [UPLOAD_METADATA.batch]: this.plan.batchId, [UPLOAD_METADATA.index]: String(slot), [UPLOAD_METADATA.filename]: file.name },
      onShouldRetry: (error) => {
        const status = statusOf(error);
        return status === null || status >= HTTP_SERVER_ERROR || RETRYABLE_CLIENT_STATUSES.has(status);
      },
      onProgress: (sent) => this.events.onProgress(this.sentBefore + sent),
      onSuccess: () => {
        this.sentBefore += file.size;
        this.index += 1;
        this.current = null;
        this.events.onProgress(this.sentBefore);
        this.next();
      },
      onError: (error) => {
        if (this.paused || this.cancelled) return;
        this.events.onError(messageOf(error));
      },
    });
    this.current = upload;
    upload.start();
  }
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import type { FileRequestView } from "@/contracts/file-requests";
import { formatSize } from "@/domain/format";
import { BatchUploader } from "@/features/transfers/upload-runner";
import { useLeaveGuard } from "@/shared/hooks/useLeaveGuard";
import { ApiClientError } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Meter } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { requestApi } from "./api";

/** One drop or pick, sent as one batch. */
interface Sending {
  key: number;
  names: string[];
  total: number;
  sent: number;
  state: "sending" | "done" | "failed";
  message?: string;
}

const PERCENT = 100;

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

function limitsText(view: FileRequestView): string | null {
  const parts = [view.filesLeft === null ? null : `${view.filesLeft} more ${view.filesLeft === 1 ? "file" : "files"}`, view.bytesLeft === null ? null : `${formatSize(Number(view.bytesLeft))} more`];
  const shown = parts.filter((part): part is string => part !== null);
  return shown.length > 0 ? `This link takes ${shown.join(", up to ")}.` : null;
}

/** Drop zone and file picker of an open upload link, with each batch's progress. */
export function RequestUploader({ view, chunkBytes }: { view: FileRequestView; chunkBytes: number }) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState<Sending[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(0);
  useLeaveGuard(batches.some((batch) => batch.state === "sending"));

  const update = (key: number, change: Partial<Sending>) => setBatches((current) => current.map((batch) => (batch.key === key ? { ...batch, ...change } : batch)));

  const send = async (files: File[]) => {
    if (files.length === 0) return;
    const key = nextKey.current++;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    setBatches((current) => [{ key, names: files.map((file) => file.name), total, sent: 0, state: "sending" }, ...current]);
    try {
      const plan = await requestApi.prepare(view.id, files.map((file) => ({ name: file.name, size: file.size })));
      new BatchUploader(plan, files, chunkBytes, {
        onProgress: (sent) => update(key, { sent }),
        onComplete: () => {
          update(key, { sent: total, state: "done" });
          router.refresh();
        },
        onError: (message) => update(key, { state: "failed", message }),
      }).start();
    } catch (caught) {
      update(key, { state: "failed", message: errorText(caught) });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void send(Array.from(event.dataTransfer.files));
  };

  const limits = limitsText(view);
  return (
    <div className="flex flex-1 justify-center px-4 py-6">
      <section aria-label="Upload files" className="flex w-[min(520px,100%)] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[22px] font-bold [overflow-wrap:anywhere]">{view.title}</h1>
          <span className="text-[14px] text-t3">{view.ownerName} asks you for files. You can add files here; you can&apos;t see what others sent.</span>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn("flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-9 text-center", dragging ? "border-accent-hi bg-accent-soft" : "border-ctrl bg-card")}
        >
          <Icon name="cloud-arrow-up" size={36} className="text-accent-icon" />
          <span className="text-[15px] font-bold">Drop files here</span>
          <Button variant="primary" size={40} icon="upload-simple" onClick={() => picker.current?.click()}>
            Choose files
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-label="Files to upload"
            onChange={(event) => {
              void send(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {(limits || view.maxFileBytes) && (
            <span className="text-[12px] text-t4">
              {limits} {view.maxFileBytes && `Each file up to ${formatSize(Number(view.maxFileBytes))}.`}
            </span>
          )}
        </div>
        {batches.map((batch) => (
          <div key={batch.key} className="flex flex-col gap-2 rounded-xl border border-card-line bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[14px]">
              <Icon
                name={batch.state === "done" ? "check-circle" : batch.state === "failed" ? "warning-circle" : "upload-simple"}
                className={batch.state === "done" ? "text-ok-text" : batch.state === "failed" ? "text-danger-text" : "text-accent-icon"}
              />
              <span className="min-w-0 flex-1 truncate font-semibold">{batch.names.length === 1 ? batch.names[0] : `${batch.names.length} files`}</span>
              <span className="shrink-0 text-[12px] text-t4">{batch.state === "done" ? "Sent" : formatSize(batch.total)}</span>
            </div>
            {batch.state === "sending" && <Meter value={batch.total === 0 ? PERCENT : (batch.sent / batch.total) * PERCENT} label={`Sending ${batch.names.length === 1 ? batch.names[0] : `${batch.names.length} files`}`} />}
            {batch.state === "failed" && (
              <span role="alert" className="text-[13px] text-danger-text">
                {batch.message}
              </span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

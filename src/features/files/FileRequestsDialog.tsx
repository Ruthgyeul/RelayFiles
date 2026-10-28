"use client";

import { useEffect, useState } from "react";
import type { CreateFileRequestInput, FileRequestDto } from "@/contracts/file-requests";
import { formatLongDate, formatSize } from "@/domain/format";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";
import { Modal, ModalBody, ModalHeader } from "@/shared/ui/Modal";
import { Pill } from "@/shared/ui/Pill";
import { QrCode } from "@/shared/ui/QrCode";
import { fileRequestsApi } from "./file-requests-api";
import { NewFileRequestForm } from "./NewFileRequestForm";

/** Side of the QR code, as in the Properties dialog. */
const QR_SIZE_PX = 176;

export interface FileRequestsRequest {
  folderId: string;
  name: string;
}

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

function received(request: FileRequestDto): string {
  const files = `${request.filesReceived}${request.maxFiles === null ? "" : ` of ${request.maxFiles}`} ${request.maxFiles === 1 ? "file" : "files"}`;
  const bytes = `${formatSize(Number(request.bytesReceived))}${request.maxBytes === null ? "" : ` of ${formatSize(Number(request.maxBytes))}`}`;
  return `${files} · ${bytes}`;
}

function RequestRow({ request, onCopy, onDelete }: { request: FileRequestDto; onCopy: () => void; onDelete: () => void }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className="flex flex-col gap-2 border-t border-card-line py-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <span className="truncate">{request.title}</span>
            {request.hasPassword && <Icon name="lock-simple" size={14} className="shrink-0 text-t4" />}
            {request.status !== "open" && <Pill tone={request.status === "full" ? "warn" : "danger"}>{request.status === "full" ? "FULL" : "EXPIRED"}</Pill>}
          </span>
          <span className="truncate text-[12px] text-t4">
            {received(request)} · {request.expiresAt ? `until ${formatLongDate(request.expiresAt)}` : "no expiry"}
          </span>
        </div>
        <IconButton icon="qr-code" label="QR code" size={32} aria-pressed={showQr} onClick={() => setShowQr((shown) => !shown)} />
        <IconButton icon="copy" label="Copy upload link" size={32} onClick={onCopy} />
        <IconButton icon="trash" label="Delete upload link" size={32} onClick={onDelete} />
      </div>
      <span className="truncate font-mono text-[12px] text-accent-text">{request.url}</span>
      {showQr && (
        <div className="flex justify-center pt-1">
          <QrCode text={request.url} size={QR_SIZE_PX} label={`QR code for ${request.url}`} />
        </div>
      )}
    </div>
  );
}

/** "Upload links" of a folder: links that let others add files to it without seeing it. */
export function FileRequestsDialog({ request, notify, onClose }: { request: FileRequestsRequest; notify: (message: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<FileRequestDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Bumped after each change to load the list again. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fileRequestsApi
      .list(request.folderId)
      .then((list) => !cancelled && setItems(list))
      .catch((caught: unknown) => !cancelled && notify(errorText(caught)));
    return () => {
      cancelled = true;
    };
  }, [request.folderId, notify, version]);

  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      notify(await action());
      setVersion((current) => current + 1);
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = (input: CreateFileRequestInput) =>
    void act(async () => {
      const created = await fileRequestsApi.create(input);
      await navigator.clipboard?.writeText(created.url).catch(() => undefined);
      setCreating(false);
      return "Upload link created and copied";
    });

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    notify("Upload link copied");
  };

  return (
    <Modal open onClose={onClose} width={520} label="Upload links">
      <ModalHeader icon="tray-arrow-down" title="Upload links" subtitle={request.name} onClose={onClose} />
      <ModalBody className="gap-3">
        <span className="text-[13px] text-pretty text-t3">Anyone with an upload link can add files to this folder. They can&apos;t see, download or change anything in it.</span>
        {creating ? (
          <NewFileRequestForm folderId={request.folderId} busy={busy} onCreate={create} onCancel={() => setCreating(false)} />
        ) : (
          <Button variant="primary" size={36} icon="plus" onClick={() => setCreating(true)} className="self-start px-3.5">
            New upload link
          </Button>
        )}
        <div className="flex flex-col">
          {items?.length === 0 && <span className="border-t border-card-line py-3 text-[13px] text-t4">No upload links for this folder yet.</span>}
          {items?.map((item) => (
            <RequestRow
              key={item.id}
              request={item}
              onCopy={() => copy(item.url)}
              onDelete={() =>
                void act(async () => {
                  await fileRequestsApi.remove(item.id);
                  return "Upload link deleted";
                })
              }
            />
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}

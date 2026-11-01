import { TRANSFERS } from "@/config/policy";
import type { PrepareUploadResult } from "@/contracts/uploads";
import { folderCount } from "@/domain/upload";
import { initialItems } from "./transfer-items";
import type { DownloadRequest, FolderDownloadRequest, Transfer, UploadTarget } from "./transfers-context";

// New entries of the transfers panel.

/** Per-file list only for batches of several files. */
const itemsFor = (files: readonly { name: string; size: number }[]) => (files.length >= TRANSFERS.fileListMin ? initialItems(files) : undefined);

const nothingYet = { done: 0, auto: false, activeMs: 0 } as const;

/** An upload batch the server prepared, running from now. */
export function uploadTransfer(plan: Extract<PrepareUploadResult, { kind: "ready" }>, target: UploadTarget): Transfer {
  return {
    ...nothingYet,
    id: plan.batchId,
    direction: "up",
    title: plan.folder.name,
    folderId: plan.folder.id,
    fromHome: target.ref === "home",
    files: plan.files.length,
    folders: folderCount(plan.files.map((file) => file.rel)),
    total: plan.files.reduce((sum, file) => sum + file.size, 0),
    status: "active",
    runningSince: Date.now(),
    items: itemsFor(plan.files.map((file) => ({ name: file.rel, size: file.size }))),
  };
}

/** A download handed to the browser: no progress to show. */
export function handedDownload(id: string, request: DownloadRequest): Transfer {
  return { ...nothingYet, id, direction: "down", title: request.title, folderId: "", fromHome: false, files: request.files, folders: 0, total: request.total, status: "handed", runningSince: null };
}

/** Items saved into a picked folder file by file, running from now. */
export function folderDownload(id: string, request: FolderDownloadRequest): Transfer {
  return {
    ...nothingYet,
    id,
    direction: "down",
    title: request.title,
    folderId: "",
    fromHome: false,
    files: request.items.length,
    folders: 0,
    total: request.items.reduce((sum, item) => sum + item.size, 0),
    status: "active",
    runningSince: Date.now(),
    items: itemsFor(request.items),
  };
}

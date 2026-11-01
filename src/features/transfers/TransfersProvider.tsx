"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { TRANSFERS } from "@/config/policy";
import type { DuplicatePolicy, PrepareUploadResult } from "@/contracts/uploads";
import { nameError } from "@/domain/names";
import { folderCount, uploadFallbackName } from "@/domain/upload";
import { useShell } from "@/features/shell/ShellProvider";
import { useLeaveGuard } from "@/shared/hooks/useLeaveGuard";
import { ApiClientError, apiFetch } from "@/shared/lib/api-client";
import { claimUpload } from "./api";
import { DuplicateDialog, type DuplicateRequest } from "./DuplicateDialog";
import { canSaveToFolder, FolderDownloader, pickSaveFolder } from "./download-runner";
import type { UploadEntry } from "./read-drop";
import { hasUnfinishedUploads } from "./resume-candidates";
import { initialItems } from "./transfer-items";
import { TransfersContext, type DownloadRequest, type FolderDownloadRequest, type Transfer, type TransfersContextValue, type UploadTarget } from "./transfers-context";
import { BatchUploader } from "./upload-runner";
import { useItemProgress } from "./useItemProgress";
import { useFilePickers } from "./useFilePickers";
import { useOfflinePause } from "./useOfflinePause";

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
/** Per-file list only for batches of several files. */
const itemsFor = (files: readonly { name: string; size: number }[]) => (files.length >= TRANSFERS.fileListMin ? initialItems(files) : undefined);
const failedText = (failed: number, files: number, firstError?: string) => `${failed} of ${files} ${files === 1 ? "file" : "files"} failed${firstError ? ` · ${firstError}` : ""}`;

/** What the provider needs from a running batch (uploads also pause). */
interface Runner {
  cancel: () => void;
  cancelFile: (slot: number) => boolean;
  pause?: () => void;
  resume?: () => void;
}

/**
 * Transfer state for the whole app: file pickers, prepare + duplicate dialog, tus batches,
 * pause/resume (automatic while offline), downloads into a picked folder, per-file progress and
 * cancel, and the transfers panel data.
 */
export function TransfersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { notify, config, activeAccount } = useShell();
  const accountId = activeAccount?.id;
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [panel, setPanelState] = useState({ open: false, expanded: true });
  const [lastUpload, setLastUpload] = useState<{ folderId: string; name: string } | null>(null);
  const [duplicate, setDuplicate] = useState<(DuplicateRequest & { entries: UploadEntry[]; target: UploadTarget }) | null>(null);
  const runners = useRef(new Map<string, Runner>());
  // crypto.randomUUID() exists only in secure contexts; plain-http LAN access must work too.
  const downloadSeq = useRef(0);

  const update = useCallback((id: string, patch: (transfer: Transfer) => Partial<Transfer>) => {
    setTransfers((list) => list.map((transfer) => (transfer.id === id ? { ...transfer, ...patch(transfer) } : transfer)));
  }, []);
  const stopClock = (transfer: Transfer) => ({ activeMs: transfer.activeMs + (transfer.runningSince ? Date.now() - transfer.runningSince : 0), runningSince: null });
  const fileEvents = useItemProgress(setTransfers);
  /** Ends a batch: complete, or failed when some files failed (the others are done). */
  const finish = useCallback(
    (id: string, failed: number, firstError?: string) => {
      runners.current.delete(id);
      update(id, (current) => (failed > 0 ? { status: "error", error: failedText(failed, current.files, firstError), ...stopClock(current) } : { status: "complete", done: current.total, ...stopClock(current) }));
      if (failed > 0) notify(failedText(failed, failed, firstError));
    },
    [notify, update],
  );

  const start = useCallback(
    (entries: UploadEntry[], target: UploadTarget, dup?: DuplicatePolicy) => {
      void (async () => {
        try {
          const plan = await apiFetch<PrepareUploadResult>("/api/uploads", {
            method: "POST",
            json: { target: target.ref, dup, files: entries.map((entry) => ({ rel: entry.rel, size: entry.file.size })), fallbackName: uploadFallbackName(new Date()) },
          });
          if (plan.kind === "duplicates") return setDuplicate({ names: plan.names, folderName: target.name, entries, target });
          if (plan.kind === "nothing") return notify("Nothing to upload · all files already exist");
          const files = plan.files.map((file) => entries[file.index]!.file);
          const id = plan.batchId;
          const transfer: Transfer = {
            id,
            direction: "up",
            title: plan.folder.name,
            folderId: plan.folder.id,
            fromHome: target.ref === "home",
            files: files.length,
            folders: folderCount(plan.files.map((file) => file.rel)),
            total: plan.files.reduce((sum, file) => sum + file.size, 0),
            done: 0,
            status: "active",
            auto: false,
            activeMs: 0,
            runningSince: Date.now(),
            items: itemsFor(plan.files.map((file) => ({ name: file.rel, size: file.size }))),
          };
          const runner = new BatchUploader(
            plan,
            files,
            config.uploadChunkBytes,
            {
              ...fileEvents(id),
              onProgress: (done) => update(id, () => ({ done })),
              onComplete: (failed, firstError) => {
                finish(id, failed, firstError);
                if (transfer.fromHome && failed < files.length) setLastUpload({ folderId: transfer.folderId, name: transfer.title });
                router.refresh();
              },
              onError: (message) => {
                update(id, (current) => ({ status: "error", error: message, ...stopClock(current) }));
                notify(message);
                router.refresh();
              },
            },
            // A file whose upload a reload interrupted continues where it stopped.
            { continueOnError: true, resume: accountId ? { scope: accountId, claim: claimUpload } : undefined },
          );
          runners.current.set(id, runner);
          setTransfers((list) => [transfer, ...list]);
          setPanelState({ open: true, expanded: true });
          runner.start();
        } catch (caught) {
          notify(errorText(caught));
        }
      })();
    },
    [accountId, config.uploadChunkBytes, fileEvents, finish, notify, router, update],
  );

  const upload = useCallback(
    (entries: UploadEntry[], target: UploadTarget) => {
      // Names the file system can't store are skipped, like the design.
      const bad = entries.filter((entry) => entry.rel.split("/").some((part) => nameError(part)));
      if (bad.length) {
        const first = bad[0]!.rel.split("/").find((part) => nameError(part))!;
        notify(`${bad.length} ${bad.length === 1 ? "file" : "files"} skipped: ${nameError(first)}`);
      }
      const good = entries.filter((entry) => !bad.includes(entry));
      if (good.length) start(good, target);
    },
    [notify, start],
  );

  const download = useCallback((request: DownloadRequest) => {
    // The browser streams the file to disk (Content-Disposition: attachment), so no page change.
    const anchor = document.createElement("a");
    anchor.href = request.url;
    anchor.download = "";
    anchor.rel = "noopener";
    anchor.click();
    const transfer: Transfer = {
      id: `download-${(downloadSeq.current += 1)}`,
      direction: "down",
      title: request.title,
      folderId: "",
      fromHome: false,
      files: request.files,
      folders: 0,
      total: request.total,
      done: 0,
      status: "handed",
      auto: false,
      activeMs: 0,
      runningSince: null,
    };
    setTransfers((list) => [transfer, ...list]);
    setPanelState({ open: true, expanded: true });
  }, []);

  const downloadToFolder = useCallback(
    (request: FolderDownloadRequest, fallback: () => void) => {
      if (!canSaveToFolder()) return false;
      // The picker opens before the first await, while the click still counts as a user gesture.
      const picking = pickSaveFolder();
      void (async () => {
        let dir: FileSystemDirectoryHandle | null;
        try {
          dir = await picking;
        } catch {
          return fallback();
        }
        if (!dir) return;
        const id = `download-${(downloadSeq.current += 1)}`;
        const runner = new FolderDownloader(dir, request.items, { ...fileEvents(id), onProgress: (done) => update(id, () => ({ done })), onComplete: (failed, firstError) => finish(id, failed, firstError) });
        const transfer: Transfer = {
          id,
          direction: "down",
          title: request.title,
          folderId: "",
          fromHome: false,
          files: request.items.length,
          folders: 0,
          total: request.items.reduce((sum, item) => sum + item.size, 0),
          done: 0,
          status: "active",
          auto: false,
          activeMs: 0,
          runningSince: Date.now(),
          items: itemsFor(request.items),
        };
        runners.current.set(id, runner);
        setTransfers((list) => [transfer, ...list]);
        setPanelState({ open: true, expanded: true });
        runner.start();
      })();
      return true;
    },
    [fileEvents, finish, update],
  );

  const pause = useCallback(
    (id: string, auto: boolean) => {
      runners.current.get(id)?.pause?.();
      update(id, (current) => ({ status: "paused", auto, ...stopClock(current) }));
    },
    [update],
  );
  const resume = useCallback(
    (id: string) => {
      runners.current.get(id)?.resume?.();
      update(id, () => ({ status: "active", auto: false, runningSince: Date.now() }));
    },
    [update],
  );

  useOfflinePause(transfers, pause, resume);
  useLeaveGuard(hasUnfinishedUploads(transfers));
  const pickers = useFilePickers(upload);

  const value = useMemo<TransfersContextValue>(
    () => ({
      transfers,
      panelOpen: panel.open,
      panelExpanded: panel.expanded,
      lastUpload,
      upload,
      download,
      downloadToFolder,
      pickFiles: pickers.pickFiles,
      pickFolder: pickers.pickFolder,
      togglePause: (id) => {
        const transfer = transfers.find((entry) => entry.id === id);
        if (transfer?.status === "active") pause(id, false);
        else if (transfer?.status === "paused") resume(id);
      },
      remove: (id) => {
        runners.current.get(id)?.cancel();
        runners.current.delete(id);
        setTransfers((list) => list.filter((entry) => entry.id !== id));
      },
      cancelItem: (id, key) => {
        runners.current.get(id)?.cancelFile(key);
      },
      clearFinished: () => setTransfers((list) => list.filter((entry) => entry.status === "active" || entry.status === "paused")),
      setPanel: (open, expanded) => setPanelState((current) => ({ open, expanded: expanded ?? current.expanded })),
    }),
    [transfers, panel, lastUpload, upload, download, downloadToFolder, pause, resume, pickers.pickFiles, pickers.pickFolder],
  );

  return (
    <TransfersContext value={value}>
      {children}
      {pickers.inputs}
      <DuplicateDialog request={duplicate} onChoose={(policy) => duplicate && start(duplicate.entries, duplicate.target, policy)} onClose={() => setDuplicate(null)} />
    </TransfersContext>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DuplicatePolicy } from "@/contracts/uploads";
import { nameError } from "@/domain/names";
import { folderCount, uploadFallbackName } from "@/domain/upload";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError, apiFetch } from "@/shared/lib/api-client";
import type { PrepareUploadResult } from "@/contracts/uploads";
import { DuplicateDialog, type DuplicateRequest } from "./DuplicateDialog";
import { entriesFromList, type UploadEntry } from "./read-drop";
import type { TransferStatus } from "./transfer-text";
import { BatchUploader } from "./upload-runner";

/** Where an upload goes: "home" (new folder at the root), "root", or a folder id. */
export interface UploadTarget {
  ref: string;
  name: string;
}

/** A download handed to the browser: what the panel shows about it. */
export interface DownloadRequest {
  url: string;
  title: string;
  files: number;
  total: number;
}

export interface Transfer {
  id: string;
  direction: "up" | "down";
  title: string;
  folderId: string;
  fromHome: boolean;
  files: number;
  folders: number;
  total: number;
  done: number;
  status: TransferStatus;
  auto: boolean;
  error?: string;
  /** Time spent transferring before the current run, and when the current run started. */
  activeMs: number;
  runningSince: number | null;
}

interface TransfersContextValue {
  transfers: Transfer[];
  panelOpen: boolean;
  panelExpanded: boolean;
  lastUpload: { folderId: string; name: string } | null;
  pickFiles: (target: UploadTarget) => void;
  pickFolder: (target: UploadTarget) => void;
  upload: (entries: UploadEntry[], target: UploadTarget) => void;
  download: (request: DownloadRequest) => void;
  togglePause: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setPanel: (open: boolean, expanded?: boolean) => void;
}

const TransfersContext = createContext<TransfersContextValue | null>(null);

export function useTransfers(): TransfersContextValue {
  const value = useContext(TransfersContext);
  if (!value) throw new Error("useTransfers must be used inside <TransfersProvider>.");
  return value;
}

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/**
 * Upload state for the whole app: file pickers, prepare + duplicate dialog, tus batches,
 * pause/resume (automatic while offline) and the transfers panel data.
 */
export function TransfersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { notify, config } = useShell();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [panel, setPanelState] = useState({ open: false, expanded: true });
  const [lastUpload, setLastUpload] = useState<{ folderId: string; name: string } | null>(null);
  const [duplicate, setDuplicate] = useState<(DuplicateRequest & { entries: UploadEntry[]; target: UploadTarget }) | null>(null);
  const runners = useRef(new Map<string, BatchUploader>());
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<UploadTarget | null>(null);

  const update = useCallback((id: string, patch: (transfer: Transfer) => Partial<Transfer>) => {
    setTransfers((list) => list.map((transfer) => (transfer.id === id ? { ...transfer, ...patch(transfer) } : transfer)));
  }, []);
  const stopClock = (transfer: Transfer) => ({ activeMs: transfer.activeMs + (transfer.runningSince ? Date.now() - transfer.runningSince : 0), runningSince: null });

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
          };
          const runner = new BatchUploader(plan, files, config.uploadChunkBytes, {
            onProgress: (done) => update(id, () => ({ done })),
            onComplete: () => {
              runners.current.delete(id);
              update(id, (current) => ({ status: "complete", done: current.total, ...stopClock(current) }));
              if (transfer.fromHome) setLastUpload({ folderId: transfer.folderId, name: transfer.title });
              router.refresh();
            },
            onError: (message) => {
              update(id, (current) => ({ status: "error", error: message, ...stopClock(current) }));
              notify(message);
              router.refresh();
            },
          });
          runners.current.set(id, runner);
          setTransfers((list) => [transfer, ...list]);
          setPanelState({ open: true, expanded: true });
          runner.start();
        } catch (caught) {
          notify(errorText(caught));
        }
      })();
    },
    [config.uploadChunkBytes, notify, router, update],
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
      id: crypto.randomUUID(),
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

  const pause = useCallback(
    (id: string, auto: boolean) => {
      runners.current.get(id)?.pause();
      update(id, (current) => ({ status: "paused", auto, ...stopClock(current) }));
    },
    [update],
  );
  const resume = useCallback(
    (id: string) => {
      runners.current.get(id)?.resume();
      update(id, () => ({ status: "active", auto: false, runningSince: Date.now() }));
    },
    [update],
  );

  // Pause everything while offline and continue once the connection is back (design).
  const latest = useRef(transfers);
  useEffect(() => {
    latest.current = transfers;
  });
  useEffect(() => {
    const onOffline = () => latest.current.filter((transfer) => transfer.status === "active").forEach((transfer) => pause(transfer.id, true));
    const onOnline = () => latest.current.filter((transfer) => transfer.status === "paused" && transfer.auto).forEach((transfer) => resume(transfer.id));
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [pause, resume]);

  const value = useMemo<TransfersContextValue>(
    () => ({
      transfers,
      panelOpen: panel.open,
      panelExpanded: panel.expanded,
      lastUpload,
      upload,
      download,
      pickFiles: (target) => {
        pickTarget.current = target;
        fileInput.current?.click();
      },
      pickFolder: (target) => {
        pickTarget.current = target;
        folderInput.current?.click();
      },
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
      clearFinished: () => setTransfers((list) => list.filter((entry) => entry.status === "active" || entry.status === "paused")),
      setPanel: (open, expanded) => setPanelState((current) => ({ open, expanded: expanded ?? current.expanded })),
    }),
    [transfers, panel, lastUpload, upload, download, pause, resume],
  );

  const onPicked = (list: FileList | null) => {
    const target = pickTarget.current;
    if (list && list.length && target) upload(entriesFromList(list), target);
  };

  return (
    <TransfersContext value={value}>
      {children}
      <input ref={fileInput} type="file" multiple hidden aria-hidden onChange={(event) => (onPicked(event.target.files), (event.target.value = ""))} />
      <input
        ref={(element) => {
          folderInput.current = element;
          // Folder pickers are not standard attributes in React's typings.
          element?.setAttribute("webkitdirectory", "");
          element?.setAttribute("directory", "");
        }}
        type="file"
        multiple
        hidden
        aria-hidden
        onChange={(event) => (onPicked(event.target.files), (event.target.value = ""))}
      />
      <DuplicateDialog request={duplicate} onChoose={(policy) => duplicate && start(duplicate.entries, duplicate.target, policy)} onClose={() => setDuplicate(null)} />
    </TransfersContext>
  );
}

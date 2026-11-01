"use client";

import { useMemo, type ReactNode } from "react";
import { useShell } from "@/features/shell/ShellProvider";
import { useLeaveGuard } from "@/shared/hooks/useLeaveGuard";
import { DuplicateDialog } from "./DuplicateDialog";
import { hasUnfinishedUploads } from "./resume-candidates";
import { TransfersContext, type TransfersContextValue } from "./transfers-context";
import { useDownloads } from "./useDownloads";
import { useFilePickers } from "./useFilePickers";
import { useOfflinePause } from "./useOfflinePause";
import { useTransferList } from "./useTransferList";
import { useUploads } from "./useUploads";

/**
 * Transfer state for the whole app: file pickers, prepare + duplicate dialog, tus batches,
 * pause/resume (automatic while offline), downloads into a picked folder, per-file progress and
 * cancel, and the transfers panel data. The list lives in useTransferList, uploads in
 * useUploads and downloads in useDownloads.
 */
export function TransfersProvider({ children }: { children: ReactNode }) {
  const { notify, config, activeAccount } = useShell();
  const list = useTransferList(notify);
  const { upload, lastUpload, duplicateDialog } = useUploads(list, { notify, chunkBytes: config.uploadChunkBytes, accountId: activeAccount?.id });
  const { download, downloadToFolder } = useDownloads(list);
  const { transfers, panel, pause, resume, remove, cancelItem, clearFinished, setPanel } = list;

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
      remove,
      cancelItem,
      clearFinished,
      setPanel,
    }),
    [transfers, panel, lastUpload, upload, download, downloadToFolder, pause, resume, remove, cancelItem, clearFinished, setPanel, pickers.pickFiles, pickers.pickFolder],
  );

  return (
    <TransfersContext value={value}>
      {children}
      {pickers.inputs}
      <DuplicateDialog {...duplicateDialog} />
    </TransfersContext>
  );
}

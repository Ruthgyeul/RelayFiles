"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useShell } from "@/features/shell/ShellProvider";
import { useLeaveGuard } from "@/shared/hooks/useLeaveGuard";
import { DuplicateDialog } from "./DuplicateDialog";
import { hasUnfinishedUploads } from "./resume-candidates";
import { TransferActionsContext, TransfersStateContext, type TransferActions, type TransfersState } from "./transfers-context";
import { useDownloads } from "./useDownloads";
import { useFilePickers } from "./useFilePickers";
import { useOfflinePause } from "./useOfflinePause";
import { useTransferList } from "./useTransferList";
import { useUploads } from "./useUploads";

/**
 * Transfer state for the whole app: file pickers, prepare + duplicate dialog, tus batches,
 * pause/resume (automatic while offline), downloads into a picked folder, per-file progress and
 * cancel, and the transfers panel data. The list lives in useTransferList, uploads in
 * useUploads and downloads in useDownloads. State and actions are two contexts, so pages that
 * only start transfers don't re-render with every progress update.
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

  // togglePause reads the latest list without changing identity on every update.
  const latest = useRef(transfers);
  useLayoutEffect(() => {
    latest.current = transfers;
  });
  const togglePause = useCallback(
    (id: string) => {
      const transfer = latest.current.find((entry) => entry.id === id);
      if (transfer?.status === "active") pause(id, false);
      else if (transfer?.status === "paused") resume(id);
    },
    [pause, resume],
  );

  const state = useMemo<TransfersState>(() => ({ transfers, panelOpen: panel.open, panelExpanded: panel.expanded, lastUpload }), [transfers, panel, lastUpload]);
  const actions = useMemo<TransferActions>(
    () => ({ upload, download, downloadToFolder, pickFiles: pickers.pickFiles, pickFolder: pickers.pickFolder, togglePause, remove, cancelItem, clearFinished, setPanel }),
    [upload, download, downloadToFolder, pickers.pickFiles, pickers.pickFolder, togglePause, remove, cancelItem, clearFinished, setPanel],
  );

  return (
    <TransferActionsContext value={actions}>
      <TransfersStateContext value={state}>
        {children}
        {pickers.inputs}
        <DuplicateDialog {...duplicateDialog} />
      </TransfersStateContext>
    </TransferActionsContext>
  );
}

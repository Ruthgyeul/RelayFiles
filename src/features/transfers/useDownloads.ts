"use client";

import { useCallback, useRef } from "react";
import { canSaveToFolder, FolderDownloader, pickSaveFolder } from "./download-runner";
import { folderDownload, handedDownload } from "./new-transfer";
import type { DownloadRequest, FolderDownloadRequest } from "./transfers-context";
import type { TransferList } from "./useTransferList";

/** Downloads: handed to the browser, or saved into a folder the user picks (with per-file progress). */
export function useDownloads({ add, fileEvents, finish, update }: TransferList) {
  // crypto.randomUUID() exists only in secure contexts; plain-http LAN access must work too.
  const downloadSeq = useRef(0);

  const download = useCallback(
    (request: DownloadRequest) => {
      // The browser streams the file to disk (Content-Disposition: attachment), so no page change.
      const anchor = document.createElement("a");
      anchor.href = request.url;
      anchor.download = "";
      anchor.rel = "noopener";
      anchor.click();
      add(handedDownload(`download-${(downloadSeq.current += 1)}`, request));
    },
    [add],
  );

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
        add(folderDownload(id, request), runner);
        runner.start();
      })();
      return true;
    },
    [add, fileEvents, finish, update],
  );

  return { download, downloadToFolder };
}

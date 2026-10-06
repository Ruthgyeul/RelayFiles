"use client";

import { useEffect, useState } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { zipName } from "@/domain/serving";
import { useShell } from "@/features/shell/ShellProvider";
import { useTransfers } from "@/features/transfers/TransfersProvider";
import { MediaViewer, type ViewerItem } from "@/features/viewer/MediaViewer";
import { fileUrls } from "./api";

type Item = Pick<NodeItem, "id" | "type" | "name" | "kind" | "size" | "fileCount">;

const toViewerItem = (item: Item): ViewerItem => ({ id: item.id, name: item.name, kind: item.kind ?? "other", src: fileUrls.stream(item.id) });

/**
 * Downloads (single file, folder or selection as zip, recorded in the transfers panel) and
 * the media viewer for the files listed in the current folder.
 */
export function useFileMedia(listed: Item[], folderName: string, initialView?: string) {
  const { notify } = useShell();
  const transfers = useTransfers();
  const files = listed.filter((item) => item.type === "file");
  const [viewing, setViewing] = useState<string | null>(() => (initialView && files.some((item) => item.id === initialView) ? initialView : null));
  // The `?view=` link only opens the viewer once; closing it leaves the plain folder URL.
  useEffect(() => {
    if (initialView) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [initialView]);

  const total = (items: Item[]) => items.reduce((sum, item) => sum + Number(item.size), 0);
  const fileCount = (items: Item[]) => items.reduce((sum, item) => sum + item.fileCount, 0);

  /** One zip for the given items (a folder, a file "as zip", or a selection). */
  const zip = (items: Item[]) => {
    if (items.length === 0) return;
    transfers.download({
      url: fileUrls.zip(items.map((item) => item.id)),
      title: zipName(items.map((item) => ({ name: item.name, folder: item.type === "folder" })), folderName),
      files: fileCount(items),
      total: total(items),
    });
  };
  const download = (item: Item) => {
    if (item.type === "folder") return zip([item]);
    transfers.download({ url: fileUrls.download(item.id), title: item.name, files: 1, total: Number(item.size) });
  };

  const viewer = (
    <MediaViewer
      items={files.map(toViewerItem)}
      currentId={viewing}
      onSelect={setViewing}
      onClose={() => setViewing(null)}
      onDownload={(id) => {
        const item = files.find((entry) => entry.id === id);
        if (item) download(item);
      }}
      notify={notify}
    />
  );

  return {
    /** Opens a file in the viewer. */
    preview: (item: Item) => setViewing(item.id),
    download,
    zip,
    /** Selection "Download": each file and folder separately, like the design. */
    downloadEach: (items: Item[]) => items.forEach(download),
    viewer,
  };
}

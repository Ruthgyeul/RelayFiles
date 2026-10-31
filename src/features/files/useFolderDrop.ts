"use client";

import { useRouter } from "next/navigation";
import type { NodeItem } from "@/contracts/nodes";
import { itemCount } from "@/domain/tree";
import { useShell } from "@/features/shell/ShellProvider";
import { entriesFromDrop } from "@/features/transfers/read-drop";
import { useTransfers, type UploadTarget } from "@/features/transfers/transfers-context";
import { ApiClientError } from "@/shared/lib/api-client";
import { filesApi } from "@/shared/lib/files-api";
import { useDragMove } from "./useDragMove";

/**
 * Drag and drop in a folder: items dragged onto a folder (a row, the path bar or "up") move
 * there; files dragged in from the computer upload into the folder they are dropped on.
 */
export function useFolderDrop(folder: NodeItem, uploadTarget: UploadTarget, items: readonly NodeItem[], selected: ReadonlySet<string>, onMoved: () => void) {
  const router = useRouter();
  const { notify } = useShell();
  const transfers = useTransfers();

  const moveTo = (ids: string[], targetId: string) =>
    filesApi
      .transfer(ids, targetId, "move")
      .then((result) => {
        notify(`Moved ${itemCount(result.done)} to ${result.targetName}${result.renamed ? ` · renamed ${result.renamed} to avoid duplicates` : ""}`);
        onMoved();
        router.refresh();
      })
      .catch((caught: unknown) => notify(caught instanceof ApiClientError ? caught.message : "Something went wrong."));
  const dropFiles = async (folderId: string, transfer: DataTransfer) => {
    const target = folderId === folder.id ? uploadTarget : { ref: folderId, name: items.find((item) => item.id === folderId)?.name ?? folder.name };
    transfers.upload(await entriesFromDrop(transfer), target);
  };
  const drag = useDragMove(selected, moveTo, (folderId, transfer) => void dropFiles(folderId, transfer));
  return { drag, dropFiles: (transfer: DataTransfer) => void dropFiles(folder.id, transfer) };
}

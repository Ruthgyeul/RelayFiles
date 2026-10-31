"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { DuplicateFile, NodeItem } from "@/contracts/nodes";
import { useShell } from "@/features/shell/ShellProvider";
import { folderHref } from "@/shared/lib/routes";
import { DuplicatesDialog, type DuplicatesRequest } from "./DuplicatesDialog";
import { RenumberDialog, type RenumberRequest } from "./RenumberDialog";

/** Folder-wide tools from the folder menu: "Renumber files" and "Find duplicates". */
export function useFolderTools(onChanged: () => void): { open: { renumber: (folder: NodeItem) => void; duplicates: (folder: NodeItem) => void }; dialogs: ReactNode } {
  const router = useRouter();
  const { notify } = useShell();
  const [renumber, setRenumber] = useState<RenumberRequest | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesRequest | null>(null);

  const changed = (message: string) => {
    notify(message);
    onChanged();
    router.refresh();
  };
  /** A copy's folder, with the copy open in the viewer. */
  const reveal = (file: DuplicateFile) => router.push(`${folderHref(file.parentId, file.parentIsRoot)}?view=${file.id}` as Parameters<typeof router.push>[0]);

  return {
    open: {
      renumber: (folder) => setRenumber({ folderId: folder.id, name: folder.name }),
      duplicates: (folder) => setDuplicates({ folderId: folder.id, name: folder.name }),
    },
    dialogs: (
      <>
        <RenumberDialog request={renumber} onClose={() => setRenumber(null)} onDone={changed} />
        <DuplicatesDialog request={duplicates} onClose={() => setDuplicates(null)} onDone={changed} onReveal={reveal} />
      </>
    ),
  };
}

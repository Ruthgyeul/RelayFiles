"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { uniqName } from "@/domain/names";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { PromptDialog } from "@/shared/ui/PromptDialog";
import { filesApi } from "./api";

/** "New folder" dialog: suggests a free name and reports when the server picked another. */
export function useNewFolder(parentRef: string, siblingNames: string[]) {
  const router = useRouter();
  const { notify } = useShell();
  const [state, setState] = useState<{ initial: string; error?: string } | null>(null);

  const create = async (name: string) => {
    try {
      const created = await filesApi.createFolder(parentRef, name);
      setState(null);
      if (created.renamed) notify(`"${created.requestedName}" already exists · created "${created.folder.name}"`);
      router.refresh();
    } catch (caught) {
      setState((current) => current && { ...current, error: caught instanceof ApiClientError ? caught.message : "Something went wrong." });
    }
  };

  return {
    open: () => setState({ initial: uniqName(siblingNames, "New folder", false) }),
    dialog: state && (
      <PromptDialog
        open
        title="New folder"
        icon="folder-plus"
        iconColor="var(--color-kind-folder)"
        initialValue={state.initial}
        confirmLabel="Create"
        error={state.error}
        onSubmit={(name) => void create(name)}
        onCancel={() => setState(null)}
      />
    ),
  };
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { FavoriteFolderDto, FavoritesView } from "@/contracts/favorites";
import type { NodeItem } from "@/contracts/nodes";
import { nameError } from "@/domain/names";
import { deleteText } from "@/features/files/useFileDialogs";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { favoritesApi } from "@/shared/lib/favorites-api";
import { filesApi } from "@/shared/lib/files-api";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { PromptDialog } from "@/shared/ui/PromptDialog";
import { MoveInFavoritesDialog, type MoveInFavoritesRequest } from "./MoveInFavoritesDialog";

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

interface Options {
  view: FavoritesView;
  /** Called after a change (clears the selection; the page data reloads). */
  onChanged: () => void;
}

/**
 * Dialogs of the Favorites page: new and renamed organizing folders, moving inside Favorites,
 * and the two choices of a delete (only Favorites, or the item itself).
 */
export function useFavoriteDialogs({ view, onChanged }: Options) {
  const router = useRouter();
  const { notify } = useShell();
  const [creating, setCreating] = useState<{ error?: string } | null>(null);
  const [renaming, setRenaming] = useState<{ folder: FavoriteFolderDto; error?: string } | null>(null);
  const [moving, setMoving] = useState<MoveInFavoritesRequest | null>(null);
  const [removing, setRemoving] = useState<NodeItem[] | null>(null);
  const [deleting, setDeleting] = useState<{ folder: FavoriteFolderDto; inside: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string>, close: () => void, onError?: (message: string) => void) => {
    setBusy(true);
    try {
      const message = await action();
      close();
      notify(message);
      onChanged();
      router.refresh();
    } catch (caught) {
      if (onError) onError(errorText(caught));
      else notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const open = {
    newFolder: () => setCreating({}),
    rename: (folder: FavoriteFolderDto) => setRenaming({ folder }),
    move: (request: MoveInFavoritesRequest) => setMoving(request),
    remove: (items: NodeItem[]) => setRemoving(items),
    deleteFolder: async (folder: FavoriteFolderDto) => {
      try {
        setDeleting({ folder, inside: (await favoritesApi.favoritesInside(folder.id)).favorites });
      } catch (caught) {
        notify(errorText(caught));
      }
    },
  };

  const removal = removing ? deleteText(removing) : null;
  const parentName = view.path.at(-2)?.name ?? "Favorites";
  const dialogs: ReactNode = (
    <>
      {creating && (
        <PromptDialog
          open
          title="New folder in Favorites"
          confirmLabel="Create"
          icon="folder-plus"
          validate={(value) => nameError(value.trim())}
          error={creating.error}
          onSubmit={(name) => void run(async () => (await favoritesApi.createFolder(view.folder?.id ?? null, name.trim()), `Created "${name.trim()}"`), () => setCreating(null), (error) => setCreating({ error }))}
          onCancel={() => setCreating(null)}
        />
      )}
      {renaming && (
        <PromptDialog
          key={renaming.folder.id}
          open
          title="Rename folder"
          initialValue={renaming.folder.name}
          confirmLabel="Rename"
          icon="folder-simple"
          validate={(value) => nameError(value.trim())}
          error={renaming.error}
          onSubmit={(name) =>
            void run(async () => (await favoritesApi.renameFolder(renaming.folder.id, name.trim()), "Renamed"), () => setRenaming(null), (error) => setRenaming({ folder: renaming.folder, error }))
          }
          onCancel={() => setRenaming(null)}
        />
      )}
      {moving && (
        <MoveInFavoritesDialog
          request={moving}
          tree={view.tree}
          busy={busy}
          onMove={(to) => void run(async () => (await favoritesApi.move(moving.nodeIds, moving.folderIds, to), `Moved ${moving.label}`), () => setMoving(null))}
          onClose={() => setMoving(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removal?.title ?? ""}
        description={`${removal?.text ?? ""} To keep ${removing?.length === 1 ? "it" : "them"} where ${removing?.length === 1 ? "it is" : "they are"}, remove ${removing?.length === 1 ? "it" : "them"} from Favorites only.`}
        confirmLabel="Delete"
        busy={busy}
        alternative={{
          label: "Remove from favorites",
          onSelect: () => removing && void run(async () => (await favoritesApi.remove(removing.map((item) => item.id)), "Removed from favorites"), () => setRemoving(null)),
        }}
        onConfirm={() => removing && void run(async () => (await filesApi.remove(removing.map((item) => item.id)), "Moved to Recently deleted"), () => setRemoving(null))}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.folder.name ?? ""}"?`}
        description={`No files are deleted. Remove the ${plural(deleting?.inside ?? 0, "favorite")} inside from Favorites, or move them and its folders up to ${parentName}.`}
        confirmLabel="Remove favorites inside"
        busy={busy}
        alternative={{
          label: "Move them up",
          onSelect: () => deleting && void run(async () => (await favoritesApi.deleteFolder(deleting.folder.id, "lift"), `Deleted "${deleting.folder.name}"`), () => setDeleting(null)),
        }}
        onConfirm={() => deleting && void run(async () => (await favoritesApi.deleteFolder(deleting.folder.id, "remove"), `Deleted "${deleting.folder.name}"`), () => setDeleting(null))}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
  return { open, dialogs };
}

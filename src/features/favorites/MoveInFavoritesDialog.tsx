"use client";

import { useState } from "react";
import { FILES } from "@/config/policy";
import type { FavoritesView } from "@/contracts/favorites";
import { favoriteDepth, favoriteTree, fitsDepth, wouldCycle } from "@/domain/favorites";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/Modal";

export interface MoveInFavoritesRequest {
  nodeIds: string[];
  folderIds: string[];
  label: string;
}

interface Props {
  request: MoveInFavoritesRequest;
  tree: FavoritesView["tree"];
  busy: boolean;
  onMove: (to: string | null) => void;
  onClose: () => void;
}

/** Picks an organizing folder (or the top of Favorites) to move favorites and folders into. */
export function MoveInFavoritesDialog({ request, tree, busy, onMove, onClose }: Props) {
  const links = favoriteTree(tree);
  const [target, setTarget] = useState<string | null>(null);
  // Parents before children, children in name order: the order the tree reads in.
  const ordered: { id: string | null; name: string; depth: number }[] = [{ id: null, name: "Favorites", depth: 0 }];
  const walk = (parentId: string | null) => {
    for (const folder of tree.filter((entry) => entry.parentId === parentId)) {
      ordered.push({ id: folder.id, name: folder.name, depth: favoriteDepth(links, folder.id) });
      walk(folder.id);
    }
  };
  walk(null);
  const allowed = (id: string | null) => request.folderIds.every((folderId) => !wouldCycle(links, folderId, id) && fitsDepth(links, folderId, id, FILES.favoriteFolderMaxDepth));

  return (
    <Modal open onClose={onClose} width={420} layer="dialog" label={`Move ${request.label} in Favorites`}>
      <ModalHeader title={`Move ${request.label}`} subtitle="Only the place in Favorites changes; the files stay where they are." onClose={onClose} icon="star" />
      <ModalBody className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
        {ordered.map((entry) => {
          const ok = allowed(entry.id);
          const selected = target === entry.id;
          return (
            <button
              key={entry.id ?? "top"}
              type="button"
              disabled={!ok}
              aria-pressed={selected}
              onClick={() => setTarget(entry.id)}
              style={{ paddingLeft: 8 + entry.depth * 18 }}
              className={cn("flex h-9 items-center gap-2 rounded-lg border-0 pr-2 text-left text-[14px]", selected ? "bg-accent-soft font-bold text-t1" : "bg-transparent text-t2 hover:bg-btn", !ok && "opacity-40")}
            >
              <Icon name={entry.id === null ? "star" : "folder-simple"} weight="fill" size={18} className={entry.id === null ? "text-warn-strong" : "text-t3"} />
              <span className="truncate">{entry.name}</span>
            </button>
          );
        })}
      </ModalBody>
      <ModalFooter className="flex justify-end gap-2">
        <Button size={38} className="px-4" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size={38} className="px-4" variant="primary" onClick={() => onMove(target)} disabled={busy || !allowed(target)}>
          Move here
        </Button>
      </ModalFooter>
    </Modal>
  );
}

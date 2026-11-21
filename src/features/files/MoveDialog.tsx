"use client";

import { useMemo, useState } from "react";
import type { FolderNode } from "@/contracts/nodes";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { useMutation } from "@/shared/hooks/useMutation";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { filesApi } from "@/shared/lib/files-api";

export interface MoveRequest {
  ids: string[];
  mode: "move" | "copy";
  /** Title target: one name in quotes, or "N items". */
  label: string;
  /** Parent folder ids of the items (a single shared parent is marked "current" when moving). */
  parentIds: string[];
}

interface Row {
  folder: FolderNode;
  depth: number;
  blocked: boolean;
  current: boolean;
}

/** Folder tree rows in display order; folders being moved and everything inside are blocked. */
function folderRows(folders: FolderNode[], request: MoveRequest): Row[] {
  const children = new Map<string | null, FolderNode[]>();
  for (const folder of folders) children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const moving = new Set(request.ids);
  const parents = new Set(request.parentIds);
  const rows: Row[] = [];
  const walk = (folder: FolderNode, depth: number, insideMoving: boolean) => {
    const blocked = insideMoving || moving.has(folder.id);
    const current = request.mode === "move" && parents.size === 1 && parents.has(folder.id);
    rows.push({ folder, depth, blocked, current });
    if (!blocked) for (const child of children.get(folder.id) ?? []) walk(child, depth + 1, blocked);
  };
  for (const root of children.get(null) ?? []) walk(root, 0, false);
  return rows;
}

/** Indentation of a row: 12px + 18px per level. */
const ROW_PADDING = { base: 12, step: 18 } as const;

/** "Move …" / "Copy …" dialog with the account's folder tree (440px). */
export function MoveDialog({ request, onClose, onDone }: { request: MoveRequest | null; onClose: () => void; onDone: (message: string) => void }) {
  // Every open asks again: the tree may have changed since the last move.
  const tree = useApiQuery<FolderNode[]>(request ? "folders" : null, () => filesApi.folderTree());
  const folders = tree.data;
  const [target, setTarget] = useState<string | null>(null);
  const sending = useMutation();
  const busy = sending.busy;
  const error = sending.error || (tree.status === "error" ? "Couldn't load folders." : "");

  const rows = useMemo(() => (request && folders ? folderRows(folders, request) : []), [folders, request]);
  const copy = request?.mode === "copy";
  const targetRow = rows.find((row) => row.folder.id === target);

  const close = () => {
    setTarget(null);
    sending.clearError();
    onClose();
  };
  const submit = async () => {
    if (!request || !targetRow) return;
    const sent = await sending.run(() => filesApi.transfer(request.ids, targetRow.folder.id, request.mode));
    if (!sent?.ok) return;
    const result = sent.value;
    const items = `${result.done} ${result.done === 1 ? "item" : "items"}`;
    onDone(`${copy ? "Copied" : "Moved"} ${items} to ${result.targetName}${result.renamed ? ` · renamed ${result.renamed} to avoid duplicates` : ""}`);
    close();
  };

  return (
    <Modal open={request !== null} onClose={close} width={440} layer="subdialog" className="overflow-hidden">
      <ModalHeader title={`${copy ? "Copy" : "Move"} ${request?.label ?? ""}`} icon={copy ? "copy" : "arrow-bend-up-right"} onClose={close} closeSize={36} />
      <div className="max-h-[50vh] min-h-[120px] flex-1 overflow-auto p-2" role="listbox" aria-label="Destination folder">
        {rows.map(({ folder, depth, blocked, current }) => {
          const root = folder.parentId === null;
          const on = target === folder.id;
          const disabled = blocked || current;
          return (
            <div
              key={folder.id}
              role="option"
              aria-selected={on}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && setTarget(folder.id)}
              onKeyDown={(event) => !disabled && (event.key === "Enter" || event.key === " ") && (event.preventDefault(), setTarget(folder.id))}
              style={{ paddingLeft: ROW_PADDING.base + depth * ROW_PADDING.step }}
              className={cn(
                "box-border flex min-h-11 items-center gap-2.5 rounded-[10px] border pr-3",
                on ? "border-accent-hi bg-accent-soft" : "border-transparent bg-transparent",
                blocked ? "opacity-40" : "opacity-100",
                disabled ? "cursor-default" : "cursor-pointer",
              )}
            >
              {root ? <Icon name="hard-drives" size={20} className="text-accent-icon" /> : <Icon name="folder-simple" weight="fill" size={20} className="text-kind-folder" />}
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{folder.name}</span>
              {(blocked || current) && <span className="text-[11px] font-bold text-t4">{blocked ? "moving" : "current"}</span>}
            </div>
          );
        })}
      </div>
      {error && <p className="m-0 px-5 pb-2 text-[13px] text-danger-text">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-card-line px-5 py-3">
        <span className="min-w-[120px] flex-1 truncate text-[13px] text-t3">{targetRow ? `${copy ? "Copy to" : "Move to"} ${targetRow.folder.name}` : "Choose a folder"}</span>
        <Button size={38} onClick={close}>
          Cancel
        </Button>
        <button
          type="button"
          disabled={!targetRow || busy}
          onClick={() => void submit()}
          className={cn("h-[38px] rounded-[10px] border border-ctrl px-4 text-[14px] font-bold", targetRow ? "bg-accent text-on-accent" : "bg-btn text-t4")}
        >
          {copy ? "Copy here" : "Move here"}
        </button>
      </div>
    </Modal>
  );
}

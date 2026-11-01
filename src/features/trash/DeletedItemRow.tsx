"use client";

import type { DeletedItemDto } from "@/contracts/trash";
import { formatSize } from "@/domain/format";
import { deletesInText, originalLocation } from "@/domain/trash";
import { itemCount } from "@/domain/tree";
import { Button } from "@/shared/ui/Button";
import { ListRow } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";
import { kindOf } from "@/shared/ui/node-kind";

interface DeletedItemRowProps {
  item: DeletedItemDto;
  now: number;
  busy: boolean;
  onRestore: () => void;
  onDeleteForever: () => void;
}

/** One item under "Recently deleted": icon, name, where it was, size, time left, Restore and Delete forever. */
export function DeletedItemRow({ item, now, busy, onRestore, onDeleteForever }: DeletedItemRowProps) {
  const icon = kindOf(item);
  const location = originalLocation(item.location);
  const inside = item.type === "folder" ? ` · ${itemCount(item.itemCount - 1)}` : "";
  return (
    <ListRow data-deleted={item.name} className="flex items-center gap-3 px-4 py-3 max-sm:flex-wrap">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-ctrl bg-btn">
        <Icon name={icon.icon} weight={item.type === "folder" ? "fill" : "regular"} size={20} style={{ color: icon.color }} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-bold" title={item.name}>
          {item.name}
        </span>
        <span className="flex min-w-0 items-center gap-[5px] text-[12px] text-t4" title={`Was in ${location}`}>
          <Icon name="folder-simple" className="shrink-0" />
          <span className="truncate">{location}</span>
        </span>
        <span className="text-[12px] text-t4">
          {formatSize(Number(item.size))}
          {inside} · <span className="text-t3">{deletesInText(item.expiresAt, now)}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:justify-end">
        <Button size={32} icon="arrow-counter-clockwise" iconSize={16} hoverable disabled={busy} onClick={onRestore} aria-label={`Restore ${item.name}`}>
          Restore
        </Button>
        <IconButton icon="trash" label={`Delete ${item.name} forever`} title="Delete forever" size={32} tone="danger" hover="btn" disabled={busy} onClick={onDeleteForever} />
      </div>
    </ListRow>
  );
}

"use client";

import { CLOCK_TICK_MS } from "@/config/policy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeletedItemDto, RestoredItem } from "@/contracts/trash";
import { retentionText } from "@/domain/trash";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useNow } from "@/shared/hooks/useNow";
import { useSelection } from "@/shared/hooks/useSelection";
import { ApiClientError, errorMessage } from "@/shared/lib/api-client";
import { folderHref } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/Button";
import { ListCard } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { trashApi } from "@/shared/lib/trash-api";
import { DeletedItemRow } from "./DeletedItemRow";


/** Toast after a restore: where the item went and under which name. */
function restoredText(result: RestoredItem): string {
  const as = result.renamed ? ` as "${result.name}"` : "";
  return result.inOriginalFolder ? `Restored${as} to ${result.folderName}` : `Its folder was deleted, so it was restored${as} to ${result.folderName}`;
}

const itemCountText = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
/** Items that can be restored (one the virus scan removed cannot). */
const restorable = (list: readonly DeletedItemDto[]) => list.filter((item) => !item.malware);

/** "Recently deleted": deleted items of the active account that can still be restored, one by one or several at once. */
export function RecentlyDeletedPage({ initial }: { initial: DeletedItemDto[] }) {
  const router = useRouter();
  const { notify, config } = useShell();
  const RETENTION = retentionText(config.trashRetentionHours);
  const [items, setItems] = useState(initial);
  // A refresh (after an action, or a change made elsewhere) brings a new list from the server:
  // it replaces the one held here, which only bridges the moment until it arrives.
  const [listed, setListed] = useState(initial);
  if (listed !== initial) {
    setListed(initial);
    setItems(initial);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [forever, setForever] = useState<DeletedItemDto[] | null>(null);
  const selection = useSelection(items);
  const now = useNow(true, CLOCK_TICK_MS.minutes);
  usePageTitle("Recently deleted");

  const act = async (item: DeletedItemDto, action: () => Promise<string>) => {
    setBusy(item.id);
    try {
      notify(await action());
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      router.refresh();
    } catch (caught) {
      notify(errorMessage(caught));
      // Gone meanwhile (restored on another device, emptied by the cleanup): show what is left.
      if (caught instanceof ApiClientError && (caught.status === 404 || caught.status === 410)) setItems(await trashApi.list().catch(() => items));
    } finally {
      setBusy(null);
    }
  };

  /** Restores or deletes forever several entries ("Restore all", "Empty", the selection). */
  const bulk = async (action: "restore" | "delete", chosen: readonly DeletedItemDto[]) => {
    if (chosen.length === 0) return;
    setBusy("bulk");
    try {
      const result = await trashApi.bulk(action, chosen.map((item) => item.id));
      const [one] = result.restored;
      notify(action === "delete" ? (result.deleted === 1 ? "Deleted forever" : `${itemCountText(result.deleted)} deleted forever`) : result.restored.length === 1 && one ? restoredText(one) : `${itemCountText(result.restored.length)} restored`);
      const done = new Set(chosen.map((item) => item.id));
      setItems((current) => current.filter((entry) => !done.has(entry.id)));
      selection.clear();
      router.refresh();
    } catch (caught) {
      notify(errorMessage(caught));
      // Some went before the error: show what is left.
      setItems(await trashApi.list().catch(() => items));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  const chosen = selection.items;

  return (
    <>
      <section aria-label="Recently deleted" className="flex items-start gap-3.5 rounded-2xl border border-card-line bg-card px-5 py-[18px]">
        <Link href={folderHref("root")} title="Back to File Manager" aria-label="Back to File Manager" className="mt-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-t3 hover:bg-btn hover:text-t3">
          <Icon name="arrow-left" size={20} />
        </Link>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-ctrl bg-btn max-sm:hidden">
          <Icon name="clock-counter-clockwise" size={24} className="text-t3" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[20px] font-bold">Recently deleted</span>
          <span className="text-[13px] text-pretty text-t4">Deleted items stay here for {RETENTION}, then they are removed for good. Restoring puts an item back in its folder with its share link and settings.</span>
          {items.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button size={34} icon="arrow-counter-clockwise" disabled={busy !== null || restorable(items).length === 0} onClick={() => void bulk("restore", restorable(items))}>
                Restore all
              </Button>
              <Button size={34} variant="danger-outline" icon="trash" disabled={busy !== null} onClick={() => setForever(items)}>
                Empty
              </Button>
            </div>
          )}
        </div>
      </section>
      {chosen.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-card-line bg-card px-4 py-2 shadow-toolbar">
          <span className="flex-1 text-[13px] font-semibold">{chosen.length} selected</span>
          <Button size={34} onClick={selection.clear}>
            Clear
          </Button>
          <Button size={34} icon="arrow-counter-clockwise" disabled={busy !== null || restorable(chosen).length === 0} onClick={() => void bulk("restore", restorable(chosen))}>
            Restore
          </Button>
          <Button size={34} variant="danger-outline" icon="trash" disabled={busy !== null} onClick={() => setForever(chosen)}>
            Delete forever
          </Button>
        </div>
      )}
      <ListCard aria-label="Deleted items">
        {items.length === 0 ? (
          <EmptyState icon="trash" title="Nothing here" description={`Items you delete stay here for ${RETENTION}.`} />
        ) : (
          items.map((item) => (
            <DeletedItemRow
              key={item.id}
              item={item}
              now={now}
              busy={busy !== null}
              selected={selection.has(item.id)}
              onToggle={() => selection.toggle(item.id)}
              onRestore={() => void act(item, async () => restoredText(await trashApi.restore(item.id)))}
              onDeleteForever={() => setForever([item])}
            />
          ))
        )}
      </ListCard>
      <ConfirmDialog
        open={forever !== null}
        tone="danger"
        icon="trash"
        title={forever?.length === 1 ? `Delete "${forever[0]!.name}" forever?` : `Delete ${itemCountText(forever?.length ?? 0)} forever?`}
        description={forever?.length === 1 ? "It is removed from the server now and can't be restored." : "They are removed from the server now and can't be restored."}
        confirmLabel="Delete forever"
        busy={busy !== null}
        onCancel={() => setForever(null)}
        onConfirm={() => {
          const chosenItems = forever!;
          setForever(null);
          const [only] = chosenItems;
          if (chosenItems.length === 1 && only)
            void act(only, async () => {
              await trashApi.deleteForever(only.id);
              return "Deleted forever";
            });
          else void bulk("delete", chosenItems);
        }}
      />
    </>
  );
}

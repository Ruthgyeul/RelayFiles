"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STORAGE } from "@/config/policy";
import type { DeletedItemDto, RestoredItem } from "@/contracts/trash";
import { retentionText } from "@/domain/trash";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useNow } from "@/shared/hooks/useNow";
import { ApiClientError } from "@/shared/lib/api-client";
import { folderHref } from "@/shared/lib/routes";
import { ListCard } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { trashApi } from "./api";
import { DeletedItemRow } from "./DeletedItemRow";

/** Re-render interval for "Deletes in N hours". */
const CLOCK_TICK_MS = 60_000;
const RETENTION = retentionText(STORAGE.trashRetentionHours);

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** Toast after a restore: where the item went and under which name. */
function restoredText(result: RestoredItem): string {
  const as = result.renamed ? ` as "${result.name}"` : "";
  return result.inOriginalFolder ? `Restored${as} to ${result.folderName}` : `Its folder was deleted, so it was restored${as} to ${result.folderName}`;
}

/** "Recently deleted": deleted items of the active account that can still be restored. */
export function RecentlyDeletedPage({ initial }: { initial: DeletedItemDto[] }) {
  const router = useRouter();
  const { notify } = useShell();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [forever, setForever] = useState<DeletedItemDto | null>(null);
  const now = useNow(true, CLOCK_TICK_MS);
  usePageTitle("Recently deleted");

  const act = async (item: DeletedItemDto, action: () => Promise<string>) => {
    setBusy(item.id);
    try {
      notify(await action());
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      router.refresh();
    } catch (caught) {
      notify(errorText(caught));
      // Gone meanwhile (restored on another device, emptied by the cleanup): show what is left.
      if (caught instanceof ApiClientError && (caught.status === 404 || caught.status === 410)) setItems(await trashApi.list().catch(() => items));
    } finally {
      setBusy(null);
    }
  };

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
        </div>
      </section>
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
              onRestore={() => void act(item, async () => restoredText(await trashApi.restore(item.id)))}
              onDeleteForever={() => setForever(item)}
            />
          ))
        )}
      </ListCard>
      <ConfirmDialog
        open={forever !== null}
        tone="danger"
        icon="trash"
        title={`Delete "${forever?.name ?? ""}" forever?`}
        description="It is removed from the server now and can't be restored."
        confirmLabel="Delete forever"
        busy={busy !== null}
        onCancel={() => setForever(null)}
        onConfirm={() => {
          const item = forever!;
          setForever(null);
          void act(item, async () => {
            await trashApi.deleteForever(item.id);
            return "Deleted forever";
          });
        }}
      />
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CollectionDto } from "@/contracts/collections";
import { CollectionDialog } from "@/features/collections/CollectionDialog";
import { collectionsApi } from "@/features/collections/api";
import { useCopyLink } from "@/features/files/useCopyLink";
import { useShell } from "@/features/shell/ShellProvider";
import { errorMessage } from "@/shared/lib/api-client";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { CollectionRow } from "./CollectionRow";

const card = "flex flex-col gap-3 rounded-2xl border border-card-line bg-card p-5";

/** "Shared by me" collections: links that share several items at once, with their settings. */
export function CollectionsCard({ collections, now }: { collections: CollectionDto[]; now: number }) {
  const router = useRouter();
  const { notify, activeAccount } = useShell();
  const { copyLink } = useCopyLink();
  const [editing, setEditing] = useState<CollectionDto | null>(null);
  const [deleting, setDeleting] = useState<CollectionDto | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (collection: CollectionDto) => {
    setBusy(true);
    try {
      await collectionsApi.remove(collection.id);
      notify("Collection link deleted");
      router.refresh();
    } catch (caught) {
      notify(errorMessage(caught));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  if (collections.length === 0) return null;
  return (
    <section aria-label="Collections" className={card}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold">Collections</h2>
        <span className="text-[12px] text-pretty text-t4">Links that share several items at once. Select items in your files and choose Collection to make one.</span>
      </div>
      <ol aria-label="Collections list" className="m-0 flex list-none flex-col p-0">
        {collections.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            now={now}
            onCopy={() => copyLink(collection.url, "public")}
            onEdit={() => setEditing(collection)}
            onDelete={() => setDeleting(collection)}
          />
        ))}
      </ol>
      {editing && (
        <CollectionDialog
          key={editing.id}
          request={{ kind: "edit", collection: editing }}
          isAdmin={activeAccount?.isAdmin ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify("Settings saved");
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the link "${deleting?.name ?? ""}"?`}
        description="The link stops working for everyone. The items stay where they are."
        confirmLabel="Delete link"
        busy={busy}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

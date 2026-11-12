"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SharedItem, SharedView } from "@/contracts/shares";
import { matchesSharedFilter, SHARED_FILTER_LABEL, SHARED_FILTERS, type SharedFilter } from "@/domain/shared-items";
import { useCopyLink } from "@/features/files/useCopyLink";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { ApiClientError } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { useNow } from "@/shared/hooks/useNow";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { sharesApi } from "./api";
import { SharedRow } from "./SharedRow";

const card = "flex flex-col gap-3 rounded-2xl border border-card-line bg-card p-5";

function privateText(items: readonly SharedItem[]): { title: string; text: string } {
  const one = items.length === 1 ? items[0] : undefined;
  return {
    title: one ? `Make "${one.name}" private?` : `Make ${items.length} items private?`,
    text: "Their links stop working for everyone else. Items inside folders stay as they are and become private with them unless they are public on their own.",
  };
}

/** "Shared by me": every item that can be opened from outside, to check and close in one place. */
export function SharedPage({ data }: { data: SharedView }) {
  usePageTitle("Shared by me");
  const router = useRouter();
  const now = useNow(false);
  const { notify, config } = useShell();
  const { copyLink } = useCopyLink();
  const [filter, setFilter] = useState<SharedFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<SharedItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = data.items.filter((item) => matchesSharedFilter(item.settings, filter));
  const chosen = data.items.filter((item) => selected.has(item.id));
  const count = (key: SharedFilter) => data.items.filter((item) => matchesSharedFilter(item.settings, key)).length;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const makePrivate = async (items: SharedItem[]) => {
    setBusy(true);
    try {
      const { updated } = await sharesApi.makePrivate(items.map((item) => item.id));
      notify(`${updated} ${updated === 1 ? "item is" : "items are"} private now`);
      setSelected(new Set());
      router.refresh();
    } catch (caught) {
      notify(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };
  const confirm = confirming ? privateText(confirming) : null;

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Shared items" className={card}>
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Shared by me</h2>
          <span className="text-[12px] text-pretty text-t4">
            Everything anyone with the link can open. A public folder stands for what is inside it; items inside are listed on their own when they have limits of their own.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SHARED_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn("h-8 rounded-full border px-3 text-[13px] font-bold", filter === key ? "border-accent-hi bg-accent-soft text-accent-text" : "border-card-line bg-card text-t3")}
            >
              {SHARED_FILTER_LABEL[key]} {count(key)}
            </button>
          ))}
        </div>
        {chosen.length > 0 && (
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-card-line bg-card px-4 py-2 shadow-toolbar">
            <span className="flex-1 text-[13px] font-semibold">{chosen.length} selected</span>
            <Button size={34} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size={34} icon="lock-simple" onClick={() => setConfirming(chosen)}>
              Make private
            </Button>
          </div>
        )}
        {shown.length === 0 ? (
          <span className="py-6 text-center text-[13px] text-t4">{data.items.length === 0 ? "Nothing is shared. Items you make public show up here." : "Nothing matches this filter."}</span>
        ) : (
          <ol aria-label="Shared items list" className="m-0 flex list-none flex-col p-0">
            {shown.map((item) => (
              <SharedRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                now={now}
                onToggle={() => toggle(item.id)}
                onCopy={() => copyLink(`${config.publicUrl}/d/${item.linkId}`, "public")}
                onMakePrivate={() => setConfirming([item])}
              />
            ))}
          </ol>
        )}
        {data.truncated && <span className="text-[12px] text-t4">Only the newest items with share settings are listed. Make some private to see the rest.</span>}
      </section>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        description={confirm?.text}
        confirmLabel="Make private"
        busy={busy}
        onConfirm={() => confirming && void makePrivate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

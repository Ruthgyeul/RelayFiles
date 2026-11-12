"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { StorageOverview } from "@/contracts/storage";
import { formatSize } from "@/domain/format";
import { quotaMeter } from "@/domain/quota";
import { deleteText } from "@/features/files/useFileDialogs";
import { useShell } from "@/features/shell/ShellProvider";
import { METER_COLOR } from "@/features/shell/StorageMeter";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { ApiClientError } from "@/shared/lib/api-client";
import { filesApi } from "@/shared/lib/files-api";
import { folderHref } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Icon } from "@/shared/ui/icon/Icon";
import { StorageFileList } from "./StorageFileList";

const PERCENT = 100;
const card = "flex flex-col gap-3 rounded-2xl border border-card-line bg-card p-5";

function Card({ label, title, note, children }: { label: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className={card}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold">{title}</h2>
        {note && <span className="text-[12px] text-pretty text-t4">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** "Storage": what uses the account's space, its largest and long-unused files, and the trash. */
export function StoragePage({ data }: { data: StorageOverview }) {
  usePageTitle("Storage");
  const router = useRouter();
  const { notify, config } = useShell();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const used = Number(data.usedBytes) + Number(data.trashBytes);
  const quota = data.quotaBytes === null ? null : Number(data.quotaBytes);
  const meter = quotaMeter(used, quota);
  const all = [...data.largest, ...data.stale.filter((item) => !data.largest.some((large) => large.id === item.id))];
  const chosen = all.filter((item) => selected.has(item.id));
  const removal = chosen.length > 0 ? deleteText(chosen, config.trashRetentionHours) : null;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async () => {
    setBusy(true);
    try {
      const { deleted } = await filesApi.remove(chosen.map((item) => item.id));
      notify(`${deleted} ${deleted === 1 ? "item" : "items"} deleted`);
      setSelected(new Set());
      router.refresh();
    } catch (caught) {
      notify(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card label="Space used" title={`${formatSize(used)} of ${quota === null ? "unlimited" : formatSize(quota)}`} note="Files in your folders and items waiting in Recently deleted both count.">
        <div className="h-2 rounded-full bg-line" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={Math.round(meter.percent)}>
          <div className="h-2 rounded-full" style={{ width: `${meter.percent.toFixed(1)}%`, background: METER_COLOR[meter.tone] }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-t2">
          <span>Files {formatSize(Number(data.usedBytes))}</span>
          <Link href="/files/deleted" className="text-accent-text">
            Recently deleted {formatSize(Number(data.trashBytes))}
          </Link>
          <span className="text-t4">Find copies of the same file with Find duplicates in a folder&apos;s menu.</span>
        </div>
      </Card>
      <Card label="By folder" title="By folder" note="What each item at the top of your files holds.">
        {data.bars.length === 0 && <span className="text-[13px] text-t4">No files yet.</span>}
        <ol aria-label="Space by item" className="m-0 flex list-none flex-col gap-2 p-0">
          {data.bars.map((bar) => (
            <li key={bar.id ?? "other"} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name={bar.id === null ? "files" : bar.folder ? "folder-simple" : "file"} size={16} className="shrink-0 text-t3" />
                {bar.id !== null && bar.folder ? (
                  <Link href={folderHref(bar.id)} className="truncate text-t1">
                    {bar.name}
                  </Link>
                ) : (
                  <span className="truncate">{bar.id === null ? `Other (${bar.count} items)` : bar.name}</span>
                )}
              </span>
              <span className="text-t2">
                {formatSize(Number(bar.bytes))} · {bar.percent}%
              </span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-btn">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${bar.percent}%` }} />
              </span>
            </li>
          ))}
        </ol>
      </Card>
      {chosen.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-card-line bg-card px-4 py-2 shadow-toolbar">
          <span className="flex-1 text-[13px] font-semibold">{chosen.length} selected</span>
          <Button size={34} onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size={34} variant="danger-outline" icon="trash" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </div>
      )}
      <Card label="Largest files" title="Largest files">
        <StorageFileList label="Largest files list" items={data.largest} empty="No files yet." selected={selected} onToggle={toggle} />
      </Card>
      <Card
        label="Not opened lately"
        title="Not opened lately"
        note={`Files added over ${data.staleAfterDays} days ago that nobody has opened or downloaded through a share link since. Your own downloads aren't recorded.`}
      >
        <StorageFileList label="Not opened lately list" items={data.stale} empty="Nothing here." selected={selected} onToggle={toggle} />
      </Card>
      <ConfirmDialog
        open={confirming && removal !== null}
        title={removal?.title ?? ""}
        description={removal?.text}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

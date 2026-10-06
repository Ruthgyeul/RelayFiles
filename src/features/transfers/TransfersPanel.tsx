"use client";

import { useRouter } from "next/navigation";
import { filesApi } from "@/features/files/api";
import { folderHref } from "@/features/files/paths";
import { useShell } from "@/features/shell/ShellProvider";
import { useNow } from "@/shared/hooks/useNow";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { panelSummary, percentDone, transferMeta, type TransferStatus } from "./transfer-text";
import { useTransfers, type Transfer } from "./TransfersProvider";

/** Look per status (design `badge`, `boxBg`, `icon`). */
const LOOK: Record<TransferStatus, { badge: string; box: string; badgeText: string; icon: IconName; weight: "fill" | "regular" | "bold"; iconColor: string }> = {
  active: { badge: "UPLOADING", box: "bg-accent-soft", badgeText: "text-accent-text", icon: "circle-notch", weight: "regular", iconColor: "text-accent-icon animate-spin" },
  paused: { badge: "PAUSED", box: "bg-warn-bg-soft", badgeText: "text-warn-text", icon: "pause", weight: "fill", iconColor: "text-warn-text" },
  complete: { badge: "COMPLETE", box: "bg-ok-bg", badgeText: "text-ok-text", icon: "check", weight: "bold", iconColor: "text-ok-text" },
  error: { badge: "FAILED", box: "bg-danger-bg", badgeText: "text-danger-text", icon: "warning", weight: "fill", iconColor: "text-danger-icon" },
  handed: { badge: "DOWNLOAD", box: "bg-accent-soft", badgeText: "text-accent-text", icon: "download-simple", weight: "bold", iconColor: "text-accent-icon" },
};

const iconButton = "flex size-[34px] items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn-h";

function TransferCard({ transfer, now }: { transfer: Transfer; now: number }) {
  const router = useRouter();
  const { notify, config } = useShell();
  const { togglePause, remove } = useTransfers();
  const look = LOOK[transfer.status];
  const inProgress = transfer.status === "active" || transfer.status === "paused";
  const elapsed = (transfer.activeMs + (transfer.runningSince ? now - transfer.runningSince : 0)) / 1_000;
  const copyLink = async () => {
    const { item } = await filesApi.getProperties(transfer.folderId);
    navigator.clipboard?.writeText(`${config.publicUrl}/d/${item.linkId}`).catch(() => undefined);
    notify("Link copied · private, only you can open it");
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-btn-h bg-sunk p-3">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[9px]", look.box)}>
          <Icon name={look.icon} weight={look.weight} size={17} className={look.iconColor} />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[15px] font-bold">{transfer.title}</span>
          <span className={cn("shrink-0 rounded-full px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.04em]", look.box, look.badgeText)}>{look.badge}</span>
        </div>
        {inProgress && (
          <button type="button" title={transfer.status === "paused" ? "Resume" : "Pause"} aria-label={transfer.status === "paused" ? "Resume" : "Pause"} onClick={() => togglePause(transfer.id)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-t2 hover:bg-btn-h">
            <Icon name={transfer.status === "paused" ? "play" : "pause"} weight="fill" size={15} />
          </button>
        )}
        <button type="button" aria-label="Remove" onClick={() => remove(transfer.id)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-t3">
          <Icon name="trash" size={16} />
        </button>
      </div>
      {inProgress && (
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-btn" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentDone(transfer)}>
          <div className={cn("h-1.5 rounded-[3px]", transfer.status === "paused" ? "bg-warn-orange" : "bg-accent")} style={{ width: `${percentDone(transfer)}%` }} />
        </div>
      )}
      <span className="text-[12px] text-t4">{transferMeta({ ...transfer, elapsed })}</span>
      {transfer.status === "complete" && (
        <div className="flex gap-1.5">
          <button type="button" onClick={() => router.push(folderHref(transfer.folderId))} className="flex h-7 items-center gap-[5px] rounded-lg border border-ctrl bg-btn px-2.5 text-[12px] font-bold text-t1">
            <Icon name="folder-open" />
            Open
          </button>
          <button type="button" onClick={() => void copyLink()} className="flex h-7 items-center gap-[5px] rounded-lg border border-ctrl bg-btn px-2.5 text-[12px] font-bold text-t1">
            <Icon name="link-simple" />
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}

/** Bottom-right transfers panel (400px) and the "Transfers · N" pill when it is closed. */
export function TransfersPanel() {
  const { transfers, panelOpen, panelExpanded, clearFinished, setPanel } = useTransfers();
  const active = transfers.filter((transfer) => transfer.status === "active" || transfer.status === "paused").length;
  const now = useNow(transfers.some((transfer) => transfer.status === "active"));
  if (transfers.length === 0) return null;

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => setPanel(true, true)}
        className="fixed right-4 bottom-4 z-(--z-transfers) flex h-[42px] items-center gap-2 rounded-full border border-ctrl bg-elev px-4 text-[14px] font-bold text-t1 shadow-popover"
      >
        <Icon name={active ? "cloud-arrow-up" : "check-circle"} className="text-accent-icon" />
        Transfers · {transfers.length}
      </button>
    );
  }

  return (
    <section
      aria-label="Transfers"
      className="fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-(--z-transfers) flex max-h-[min(60vh,480px)] w-[min(400px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-ctrl bg-elev shadow-panel"
    >
      <div className="flex items-center gap-3 py-3 pr-2.5 pl-3.5">
        <span className="flex size-9 items-center justify-center rounded-[10px] border border-accent-soft-line bg-accent-soft">
          <Icon name={active ? "cloud-arrow-up" : "check-circle"} size={18} className="text-accent-icon" />
        </span>
        <div className="flex flex-1 flex-col gap-px">
          <span className="text-[15px] font-bold">Transfers</span>
          <span className="text-[12px] text-t4">{panelSummary(active, transfers.length - active)}</span>
        </div>
        <button type="button" title="Clear finished" aria-label="Clear finished" onClick={clearFinished} className={iconButton}>
          <Icon name="broom" size={18} />
        </button>
        <button type="button" aria-label={panelExpanded ? "Collapse" : "Expand"} onClick={() => setPanel(true, !panelExpanded)} className={iconButton}>
          <Icon name={panelExpanded ? "caret-down" : "caret-up"} size={18} />
        </button>
        <button type="button" aria-label="Close transfers" onClick={() => setPanel(false)} className={iconButton}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {panelExpanded && (
        <div className="flex flex-col gap-2 overflow-auto border-t border-ctrl p-2.5">
          {transfers.map((transfer) => (
            <TransferCard key={transfer.id} transfer={transfer} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

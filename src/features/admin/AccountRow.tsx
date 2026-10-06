"use client";

import type { AdminAccount } from "@/contracts/admin";
import { accountStatus, scheduledDeletion, type AccountStatus } from "@/domain/admin";
import { formatLongDate, formatSize } from "@/domain/format";
import { BYTES_PER_GB } from "@/domain/quota";
import { cn } from "@/shared/lib/cn";
import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/icon/Icon";

/** Badge per status (design `ST`). */
const BADGE: Record<AccountStatus, { label: string; look: string }> = {
  admin: { label: "ADMIN", look: "bg-ok-bg text-ok-text" },
  active: { label: "ACTIVE", look: "bg-accent-soft text-accent-text" },
  soon: { label: "EXPIRING", look: "bg-warn-bg-soft text-warn-text" },
  expired: { label: "PENDING DELETE", look: "bg-danger-bg text-danger-text" },
};

/** Storage shown red at 90% of the limit (design `sizeColor`). */
const STORAGE_WARN_RATIO = 0.9;

function Info({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold text-t4">{label}</span>
      <span className={cn("text-t2", className)}>{children}</span>
    </div>
  );
}

interface AccountRowProps {
  account: AdminAccount;
  ttlDays: number;
  now: number;
  mounted: boolean;
  onCopyId: () => void;
  onManage: () => void;
  onDelete: () => void;
}

/** One account: avatar, name, badges, id, last sign-in, deletion, files, storage, actions. */
export function AccountRow({ account, ttlDays, now, mounted, onCopyId, onManage, onDelete }: AccountRowProps) {
  const lifecycle = { createdAt: Date.parse(account.createdAt), expiresAt: account.expiresAt ? Date.parse(account.expiresAt) : null, isAdmin: account.isAdmin, neverExpire: account.neverExpire };
  const { status, left } = accountStatus(lifecycle, ttlDays, now);
  const exempt = left === Infinity;
  const date = (at: number | string) => (mounted ? formatLongDate(at) : "");
  const used = Number(account.usedBytes);
  const quota = account.quotaBytes === null ? null : Number(account.quotaBytes);
  return (
    <div data-account={account.name} className="flex flex-wrap items-center gap-3.5 bg-card px-4 py-3.5">
      <div className="flex min-w-0 flex-[1_1_240px] items-center gap-3">
        <Avatar seed={account.id} size={38} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold">{account.name}</span>
            <span className={cn("rounded-full px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.04em]", BADGE[status].look)}>{BADGE[status].label}</span>
            {account.you && <span className="text-[11px] font-bold text-t4">YOU</span>}
            {account.here && (
              <span title="Signed in on this device" className="flex items-center gap-1 text-[11px] font-bold text-t4">
                <Icon name="desktop" />
                this device
              </span>
            )}
          </div>
          <button type="button" title="Copy ID" onClick={onCopyId} className="flex items-center gap-[5px] self-start border-0 bg-transparent p-0 font-mono text-[12px] text-t4">
            {account.id}
            <Icon name="copy" size={11} />
          </button>
        </div>
      </div>
      <div className="grid flex-[2_1_300px] grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-2.5 text-[13px]">
        <Info label="LAST SIGN-IN">{date(account.lastLoginAt)}</Info>
        <Info label="DELETES" className={exempt ? "text-ok-text" : left <= 0 ? "text-danger-text" : status === "soon" ? "text-warn-text" : undefined}>
          {exempt ? "Never" : left <= 0 ? "Next cleanup" : `${date(scheduledDeletion(lifecycle, ttlDays))} · ${left}d`}
        </Info>
        <Info label="FILES">{account.files}</Info>
        <Info label="STORAGE" className={quota !== null && used >= quota * STORAGE_WARN_RATIO ? "text-danger-text" : undefined}>
          {formatSize(used)} / {quota === null ? "∞" : `${quota / BYTES_PER_GB} GB`}
        </Info>
      </div>
      <button type="button" onClick={onManage} className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-3 text-[13px] font-bold text-t1 hover:bg-btn-h">
        <Icon name="sliders-horizontal" size={15} />
        Manage
      </button>
      {!account.isAdmin && (
        <button
          type="button"
          title="Delete account"
          aria-label={`Delete ${account.name}`}
          onClick={onDelete}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-danger-line bg-transparent text-danger-text hover:bg-danger-bg"
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );
}

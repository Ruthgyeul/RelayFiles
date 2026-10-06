"use client";

import { useState } from "react";
import type { AdminAccount, ManageInput } from "@/contracts/admin";
import { DAYS_CHOICES, managePreview, QUOTA_CHOICES, quotaNote, type DaysChoice } from "@/domain/admin";
import { formatLongDate, formatSize } from "@/domain/format";
import { BYTES_PER_GB } from "@/domain/quota";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { CheckRow, OptionChip } from "@/shared/ui/Option";

/** Smallest custom limit the dialog accepts (design: 0.1 GB). */
const MIN_CUSTOM_GB = 0.1;

interface ManageDialogProps {
  account: AdminAccount;
  ttlDays: number;
  now: number;
  /** True when this is the only admin (it can't be made a member). */
  lastAdmin: boolean;
  busy: boolean;
  onSave: (input: ManageInput) => void;
  onClose: () => void;
}

const label = "text-[13px] font-semibold text-t3";
const note = "text-[12px] text-t4";

/** Manage an account: role, deletion date, storage limit (design `manageOpen`). */
export function ManageDialog({ account, ttlDays, now, lastAdmin, busy, onSave, onClose }: ManageDialogProps) {
  const quotaGb = account.quotaBytes === null ? null : Number(account.quotaBytes) / BYTES_PER_GB;
  const [isAdmin, setIsAdmin] = useState(account.isAdmin);
  const [days, setDays] = useState<DaysChoice>(account.neverExpire ? "never" : 0);
  const [reset, setReset] = useState(false);
  const [quota, setQuota] = useState<number | null>(quotaGb);
  const [quotaText, setQuotaText] = useState(quotaGb === null ? "" : String(quotaGb));
  const lifecycle = { createdAt: Date.parse(account.createdAt), expiresAt: account.expiresAt ? Date.parse(account.expiresAt) : null, isAdmin: account.isAdmin, neverExpire: account.neverExpire };
  const draft = { isAdmin, days, reset };
  const demotingLast = lastAdmin && !isAdmin;

  return (
    <Modal open onClose={onClose} width={480} label={`Manage ${account.name}`}>
      <ModalHeader
        leading={<Avatar seed={account.id} size={36} />}
        title={`Manage ${account.name}`}
        subtitle={`${account.id} · last sign-in ${formatLongDate(account.lastLoginAt)}`}
        onClose={onClose}
      />
      <ModalBody className="gap-[18px]">
        <div className="flex flex-col gap-2">
          <span className={label}>Role</span>
          <div className="flex flex-wrap gap-1.5">
            <OptionChip selected={!isAdmin} onClick={() => setIsAdmin(false)}>
              Member
            </OptionChip>
            <OptionChip selected={isAdmin} onClick={() => setIsAdmin(true)}>
              Admin
            </OptionChip>
          </div>
          <span className={note}>Admins can open this page and manage every account.</span>
          {demotingLast && (
            <span role="alert" className="flex items-center gap-1.5 text-[12px] text-danger-text">
              <Icon name="warning-circle" />
              This is the only admin. Promote another account first.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className={label}>Deletion date</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS_CHOICES.map((choice) => (
              <OptionChip key={String(choice.value)} selected={days === choice.value} disabled={isAdmin} onClick={() => setDays(choice.value)}>
                {choice.label}
              </OptionChip>
            ))}
          </div>
          <span className={note}>{isAdmin ? "Admins are always exempt." : "Extensions are added to the current deletion date. Signing in does not extend it."}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className={label}>Storage limit</span>
          <div className="flex flex-wrap gap-1.5">
            {QUOTA_CHOICES.map((choice) => (
              <OptionChip
                key={String(choice.value)}
                selected={quota === choice.value}
                onClick={() => {
                  setQuota(choice.value);
                  setQuotaText(choice.value === null ? "" : String(choice.value));
                }}
              >
                {choice.label}
              </OptionChip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={quotaText}
              inputMode="decimal"
              placeholder="Custom"
              aria-label="Custom storage limit in GB"
              onChange={(event) => {
                const text = event.target.value.replace(/[^0-9.]/g, "");
                setQuotaText(text);
                setQuota(text === "" ? null : Math.max(MIN_CUSTOM_GB, parseFloat(text) || 0));
              }}
              className="box-border h-9 w-[110px] rounded-[10px] border border-ctrl bg-bg px-3 text-[14px] text-t1 outline-none"
            />
            <span className="text-[13px] text-t3">GB · empty = unlimited</span>
          </div>
          <span className={note}>{quotaNote(Number(account.usedBytes), quota, formatSize)}</span>
        </div>
        <CheckRow checked={reset} onCheckedChange={setReset}>
          Restart 14 days from today
        </CheckRow>
        <div className="flex gap-2.5 rounded-xl border border-ctrl bg-elev px-3.5 py-3 text-[13px] text-t2">
          <Icon name="calendar-check" size={18} className="shrink-0 text-accent-icon" />
          {managePreview(lifecycle, draft, ttlDays, now, formatLongDate)}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size={36} onClick={onClose} className="px-4 text-[14px]">
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={busy} onClick={() => onSave({ isAdmin, days, reset, quotaGb: quota })} className="px-4 text-[14px]">
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}

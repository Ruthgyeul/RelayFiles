"use client";

import { useState } from "react";
import { INVITE } from "@/config/policy";
import type { CreateInviteInput, InviteDto } from "@/contracts/server-settings";
import { formatShortDate } from "@/domain/format";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { OptionChip } from "@/shared/ui/Option";

interface InviteCodesProps {
  invites: InviteDto[];
  busy: boolean;
  onGenerate: (limits: CreateInviteInput) => void;
  onCopy: (code: string) => void;
  onRevoke: (code: string) => void;
}

const usesLabel = (uses: number) => (uses === 1 ? "1 account" : `${uses} accounts`);
const expiryLabel = (days: number | null) => (days === null ? "No expiry" : days === 1 ? "1 day" : `${days} days`);

/** One code's state: uses left and its expiry, or why it no longer works. */
function InviteState({ invite }: { invite: InviteDto }) {
  if (invite.status === "used-up") return <span className="flex-1 text-[12px] text-t4">{invite.usedBy ? `Used up · last by ${invite.usedBy}` : "Used up"}</span>;
  if (invite.status === "expired") return <span className="flex-1 text-[12px] text-t4">Expired</span>;
  const uses = invite.maxUses === 1 ? (invite.uses === 0 ? "Unused" : "Used") : `${invite.uses} / ${invite.maxUses} used`;
  return (
    <span className="flex-1 text-[12px] text-ok-text">
      {uses}
      {invite.expiresAt && (
        <>
          {" · expires "}
          <LocalDate value={invite.expiresAt} format={formatShortDate} />
        </>
      )}
    </span>
  );
}

/** "Invite codes" in invite-only mode: new codes with a use count and an expiry, and the list. */
export function InviteCodes({ invites, busy, onGenerate, onCopy, onRevoke }: InviteCodesProps) {
  const [maxUses, setMaxUses] = useState<number>(INVITE.useChoices[0]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(INVITE.defaultExpiryDays);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-ctrl bg-elev p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex-1 text-[14px] font-bold">Invite codes</span>
        <Button variant="primary" size={32} icon="plus" disabled={busy} onClick={() => onGenerate({ maxUses, expiresInDays })}>
          Generate code
        </Button>
      </div>
      <div role="group" aria-label="Accounts per code" className="flex flex-wrap gap-1.5">
        {INVITE.useChoices.map((uses) => (
          <OptionChip key={uses} height={30} selected={maxUses === uses} disabled={busy} onClick={() => setMaxUses(uses)}>
            {usesLabel(uses)}
          </OptionChip>
        ))}
      </div>
      <div role="group" aria-label="Code expiry" className="flex flex-wrap gap-1.5">
        {INVITE.expiryChoices.map((days) => (
          <OptionChip key={days ?? "never"} height={30} selected={expiresInDays === days} disabled={busy} onClick={() => setExpiresInDays(days)}>
            {expiryLabel(days)}
          </OptionChip>
        ))}
      </div>
      {invites.map((invite) => (
        <div key={invite.code} className="flex items-center gap-2.5 border-t border-ctrl py-2">
          <span className="font-mono text-[14px] font-semibold tracking-[.06em]">{invite.code}</span>
          <InviteState invite={invite} />
          <button type="button" title="Copy" aria-label={`Copy ${invite.code}`} onClick={() => onCopy(invite.code)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-t3">
            <Icon name="copy" />
          </button>
          {invite.status === "active" && (
            <button type="button" title="Revoke" aria-label={`Revoke ${invite.code}`} onClick={() => onRevoke(invite.code)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-danger-text">
              <Icon name="x-circle" />
            </button>
          )}
        </div>
      ))}
      {invites.length === 0 && <span className="text-[13px] text-t4">No codes yet. Each code creates the accounts chosen above until it expires.</span>}
    </div>
  );
}

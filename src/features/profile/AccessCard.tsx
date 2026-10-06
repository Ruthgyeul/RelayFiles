"use client";

import { useState } from "react";
import { accountApi } from "@/features/account/api";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { SectionTitle } from "./Section";

function TokenButton({ icon, label, onClick, iconSize = 18 }: { icon: IconName; label: string; onClick: () => void; iconSize?: number }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn-h">
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

interface AccessCardProps {
  accountId: string;
  maskedToken: string;
  notify: (message: string) => void;
  onRegenerate: () => void;
}

/** "Access & recovery": masked token with show, copy and regenerate, and the no-recovery warning. */
export function AccessCard({ accountId, maskedToken, notify, onRegenerate }: AccessCardProps) {
  const [shown, setShown] = useState<string | null>(null);
  const reveal = async () => (shown ? setShown(null) : setShown(await accountApi.revealToken(accountId)));
  const copy = async () => {
    await navigator.clipboard?.writeText(await accountApi.revealToken(accountId)).catch(() => undefined);
    notify("Token copied");
  };
  return (
    <section aria-label="Access & recovery" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <SectionTitle icon="key" box="bg-accent-soft" color="text-accent-icon">
        <h2 className="m-0 text-[17px] font-bold">Access &amp; recovery</h2>
      </SectionTitle>
      <div className="flex flex-col gap-2.5 rounded-xl border border-ctrl bg-elev p-4">
        <div className="flex items-center gap-2 font-bold">
          <Icon name="lock-simple" className="text-warn-strong" />
          <span className="flex-1">Account token</span>
          <TokenButton icon={shown ? "eye-slash" : "eye"} label={shown ? "Hide token" : "Show token"} onClick={() => void reveal()} />
          <TokenButton icon="copy" label="Copy token" onClick={() => void copy()} />
          <TokenButton icon="arrows-clockwise" label="Generate a new token" iconSize={16} onClick={onRegenerate} />
        </div>
        <div className="flex h-[38px] items-center overflow-hidden rounded-lg bg-sunk px-3 font-mono text-[13px] whitespace-nowrap text-t3" aria-label="Account token">
          {shown ?? maskedToken}
        </div>
        <span className="text-[12px] text-pretty text-t4">This token is the only way to sign in to this account on any device. Keep it private.</span>
      </div>
      <div className="flex gap-2.5 rounded-xl border border-danger-line bg-danger-bg px-3.5 py-3 text-[13px] leading-[1.5] text-pretty text-danger-pale">
        <Icon name="warning" weight="fill" size={18} className="mt-px shrink-0 text-danger-icon" />
        <span>There is no email, password or recovery. If you lose this token, the account and all of its files can never be accessed again.</span>
      </div>
    </section>
  );
}

"use client";

import type { SignupMode } from "@/contracts/auth";
import type { InviteDto } from "@/contracts/server-settings";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { OptionCard } from "@/shared/ui/Option";
import { THEME_COLOR } from "@/shared/styles/palette";

const MODES: readonly { mode: SignupMode; label: string; description: string }[] = [
  { mode: "open", label: "Open", description: "Anyone with the site URL" },
  { mode: "invite", label: "Invite only", description: "Needs a one-time code" },
  { mode: "closed", label: "Closed", description: "No new accounts" },
];

interface SignupCardProps {
  mode: SignupMode;
  invites: InviteDto[];
  busy: boolean;
  onMode: (mode: SignupMode) => void;
  onGenerate: () => void;
  onCopy: (code: string) => void;
  onRevoke: (code: string) => void;
}

/** "New accounts": sign-up mode and, in invite mode, the one-time codes (design `suOpts`). */
export function SignupCard({ mode, invites, busy, onMode, onGenerate, onCopy, onRevoke }: SignupCardProps) {
  return (
    <section aria-label="New accounts" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold">New accounts</h2>
        <span className="text-[13px] text-pretty text-t4">Controls who can create an anonymous account. Existing accounts can always sign in with their token.</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
        {MODES.map((option) => (
          <OptionCard
            key={option.mode}
            surface="elev"
            selected={mode === option.mode}
            disabled={busy}
            icon={mode === option.mode ? "radio-button" : "circle"}
            iconWeight={mode === option.mode ? "fill" : "regular"}
            iconSize={20}
            iconColor={THEME_COLOR.accentHi}
            description={option.description}
            onClick={() => onMode(option.mode)}
          >
            {option.label}
          </OptionCard>
        ))}
      </div>
      {mode === "invite" && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-ctrl bg-elev p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[14px] font-bold">Invite codes</span>
            <Button variant="primary" size={32} icon="plus" disabled={busy} onClick={onGenerate}>
              Generate code
            </Button>
          </div>
          {invites.map((invite) => (
            <div key={invite.code} className="flex items-center gap-2.5 border-t border-ctrl py-2">
              <span className="font-mono text-[14px] font-semibold tracking-[.06em]">{invite.code}</span>
              <span className={invite.usedBy ? "flex-1 text-[12px] text-t4" : "flex-1 text-[12px] text-ok-text"}>{invite.usedBy ? `Used by ${invite.usedBy}` : "Unused"}</span>
              <button type="button" title="Copy" aria-label={`Copy ${invite.code}`} onClick={() => onCopy(invite.code)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-t3">
                <Icon name="copy" />
              </button>
              {!invite.usedBy && (
                <button type="button" title="Revoke" aria-label={`Revoke ${invite.code}`} onClick={() => onRevoke(invite.code)} className="flex size-[30px] items-center justify-center rounded-lg border-0 bg-transparent text-danger-text">
                  <Icon name="x-circle" />
                </button>
              )}
            </div>
          ))}
          {invites.length === 0 && <span className="text-[13px] text-t4">No codes yet. Each code creates one account.</span>}
        </div>
      )}
    </section>
  );
}

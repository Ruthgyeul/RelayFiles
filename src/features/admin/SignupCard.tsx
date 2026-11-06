"use client";

import type { SignupMode } from "@/contracts/auth";
import type { CreateInviteInput, InviteDto } from "@/contracts/server-settings";
import { OptionCard } from "@/shared/ui/Option";
import { THEME_COLOR } from "@/shared/styles/palette";
import { InviteCodes } from "./InviteCodes";

const MODES: readonly { mode: SignupMode; label: string; description: string }[] = [
  { mode: "open", label: "Open", description: "Anyone with the site URL" },
  { mode: "invite", label: "Invite only", description: "Needs an invite code" },
  { mode: "closed", label: "Closed", description: "No new accounts" },
];

interface SignupCardProps {
  mode: SignupMode;
  invites: InviteDto[];
  busy: boolean;
  onMode: (mode: SignupMode) => void;
  onGenerate: (limits: CreateInviteInput) => void;
  onCopy: (code: string) => void;
  onRevoke: (code: string) => void;
}

/** "New accounts": sign-up mode and, in invite mode, the one-time codes. */
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
      {mode === "invite" && <InviteCodes invites={invites} busy={busy} onGenerate={onGenerate} onCopy={onCopy} onRevoke={onRevoke} />}
    </section>
  );
}

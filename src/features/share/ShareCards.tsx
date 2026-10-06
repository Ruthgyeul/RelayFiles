"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { errorText, shareApi } from "./api";

/** Centered 400px card of the share page states (design `shBlocked`, `shExpired`, …). */
function StateCard({ icon, iconBox, iconColor, title, gap = "gap-3", children }: { icon: IconName; iconBox: string; iconColor: string; title: string; gap?: "gap-3" | "gap-3.5"; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6">
      <section aria-label={title} className={cn("flex w-[min(400px,100%)] flex-col items-center rounded-2xl border border-card-line bg-card px-6 py-7 text-center", gap)}>
        <span className={cn("flex size-14 items-center justify-center rounded-[14px]", iconBox)}>
          <Icon name={icon} weight="fill" size={26} className={iconColor} />
        </span>
        <h1 className="m-0 text-[19px] font-bold">{title}</h1>
        {children}
      </section>
    </div>
  );
}

const description = "text-[14px] leading-[1.5] text-pretty text-t3";

export function BlockedCard() {
  return (
    <StateCard icon="prohibit" iconBox="bg-danger-bg" iconColor="text-danger-icon" title="Download limit reached">
      <p className={cn("m-0", description)}>This link has been used the maximum number of times. Ask the owner for a new link.</p>
    </StateCard>
  );
}

export function ExpiredCard() {
  return (
    <StateCard icon="hourglass-simple-low" iconBox="bg-warn-bg-soft" iconColor="text-warn-strong" title="This link has expired">
      <p className={cn("m-0", description)}>The files reached their expiry date or download limit and were deleted from the server.</p>
    </StateCard>
  );
}

/** Private link; the owner previewing it can make it public right here. */
export function PrivateCard({ ownerNodeId, notify }: { ownerNodeId: string | null; notify: (message: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const makePublic = async (nodeId: string) => {
    setBusy(true);
    try {
      await shareApi.makePublic(nodeId);
      notify("Now public");
      router.refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <StateCard icon="lock-key" iconBox="border border-ctrl bg-btn" iconColor="text-t3" title="This link is private">
      <p className={cn("m-0", description)}>Only the owner can open it. Ask them to make it public.</p>
      {ownerNodeId && (
        <div className="mt-2 flex w-full flex-col gap-2 border-t border-dashed border-ctrl pt-3.5">
          <span className="text-[12px] text-t4">You&apos;re previewing as a visitor.</span>
          <Button variant="primary" size={40} icon="globe-simple" disabled={busy} onClick={() => void makePublic(ownerNodeId)} className="justify-center gap-1.5 border-0">
            Make public
          </Button>
        </div>
      )}
    </StateCard>
  );
}

/** Password form (design `shLocked`); a right password reloads the page unlocked. */
export function LockedCard({ linkId, name }: { linkId: string; name: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await shareApi.unlock(linkId, password);
      router.refresh();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };
  return (
    <StateCard icon="lock-simple" iconBox="bg-warn-bg-soft" iconColor="text-warn-strong" title="This folder is password protected" gap="gap-3.5">
      <p className="m-0 text-[14px] text-t3">Enter the password you were given to view {name}.</p>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          type="password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          autoComplete="off"
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          className="box-border h-11 w-full rounded-[10px] border border-ctrl bg-bg px-3.5 text-[15px] text-t1 outline-none"
        />
        {error && (
          <span role="alert" className="flex items-center gap-1.5 self-start text-[13px] text-danger-text">
            <Icon name="warning-circle" />
            {error}
          </span>
        )}
        <Button type="submit" variant="primary" size={44} disabled={busy} className="w-full justify-center border-0">
          Unlock
        </Button>
      </form>
    </StateCard>
  );
}

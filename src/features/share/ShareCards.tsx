"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { PasswordCard } from "@/shared/ui/PasswordCard";
import { StateCard } from "@/shared/ui/StateCard";
import { errorText, shareApi } from "./api";

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

/** Password form; a right password reloads the page unlocked. */
export function LockedCard({ linkId, name }: { linkId: string; name: string }) {
  return <PasswordCard title="This folder is password protected" description={`Enter the password you were given to view ${name}.`} onUnlock={(password) => shareApi.unlock(linkId, password)} />;
}

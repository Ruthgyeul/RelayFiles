"use client";

import { useEffect, useRef } from "react";
import { Logo } from "@/shared/ui/Display";
import { AccountList } from "./AccountList";
import { NavList } from "./NavList";
import { useShell } from "./ShellProvider";
import { StorageMeter } from "./StorageMeter";

/** Navigation drawer below 1024px: 260px panel over a .55 backdrop. */
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, activeAccount } = useShell();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="lg:hidden">
      <div aria-hidden className="fixed inset-0 z-(--z-drawer-backdrop) bg-backdrop-drawer" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="fixed top-0 bottom-0 left-0 z-(--z-drawer) flex w-[260px] flex-col overflow-y-auto border-r border-line bg-sunk pb-[env(safe-area-inset-bottom)] outline-none"
      >
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line px-5 text-[18px] font-bold">
          <Logo size={28} />
          RelayFiles
        </div>
        <AccountList variant="drawer" onNavigate={onClose} />
        <NavList variant="drawer" isAdmin={activeAccount?.isAdmin ?? false} onNavigate={onClose} />
        <div className="flex-1" />
        <StorageMeter account={activeAccount} usage={session.usage} />
      </div>
    </div>
  );
}

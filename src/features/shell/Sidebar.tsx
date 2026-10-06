"use client";

import { cn } from "@/shared/lib/cn";
import { Logo } from "@/shared/ui/Display";
import { AccountList } from "./AccountList";
import { NavList } from "./NavList";
import { useShell } from "./ShellProvider";
import { StorageMeter } from "./StorageMeter";

/** Desktop sidebar (≥1024px): sticky, 240px, collapses to 68px with avatars and icons only. */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { session, activeAccount } = useShell();
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "sticky top-0 z-(--z-sidebar) hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-sunk transition-[width] duration-[.18s] ease-[ease] lg:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line px-5 text-[18px] font-bold">
        <Logo size={28} />
        {!collapsed && "RelayFiles"}
      </div>
      <AccountList variant="sidebar" collapsed={collapsed} />
      <NavList variant="sidebar" isAdmin={activeAccount?.isAdmin ?? false} collapsed={collapsed} />
      <div className="flex-1" />
      {!collapsed && <StorageMeter account={activeAccount} usage={session.usage} />}
    </aside>
  );
}

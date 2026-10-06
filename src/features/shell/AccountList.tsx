"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { SessionAccount } from "@/contracts/auth";
import { formatShortDate } from "@/domain/format";
import { cn } from "@/shared/lib/cn";
import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/icon/Icon";
import { Menu, MenuItem } from "@/shared/ui/Menu";
import { useShell } from "./ShellProvider";

/** Second line of an account row (design `role`). */
export function accountRole(account: SessionAccount): string {
  if (account.isAdmin) return "Admin · never expires";
  if (account.neverExpire || !account.deletesAt) return "Never expires";
  return `Deletes ${formatShortDate(account.deletesAt)}`;
}

interface AccountListProps {
  /** The sidebar has per-account menus and hover states; the drawer has neither in the design. */
  variant: "sidebar" | "drawer";
  /** Desktop sidebar collapsed to 68px: avatars only. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** Signed-in accounts plus "Add account", as in the sidebar and the drawer. */
export function AccountList({ variant, collapsed = false, onNavigate }: AccountListProps) {
  const withMenu = variant === "sidebar";
  const { session, switchTo, signOutAccount, copyToken, openSignIn } = useShell();
  const router = useRouter();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuFor(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuFor]);

  const openProfile = async (account: SessionAccount) => {
    setMenuFor(null);
    onNavigate?.();
    if (account.id !== session.activeAccountId) await switchTo(account.id);
    router.push("/settings" as Route);
  };

  const select = (account: SessionAccount) => {
    setMenuFor(null);
    onNavigate?.();
    // Clicking the active account opens its profile; another account becomes active.
    if (account.id === session.activeAccountId) router.push("/settings" as Route);
    else void switchTo(account.id);
  };

  const rowClass = cn("flex items-center gap-2.5 rounded-xl border", collapsed ? "justify-center p-0.5" : "justify-start p-2");

  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      {session.accounts.map((account) => {
        const active = account.id === session.activeAccountId;
        return (
          <div key={account.id} className="relative">
            {/* The card holds two sibling controls: the account itself and its menu (no nested buttons). */}
            <div className={cn(rowClass, active ? "border-accent-soft-line bg-accent-soft" : "border-transparent bg-transparent")}>
              <button
                type="button"
                title={account.name}
                aria-label={account.name}
                aria-current={active ? "true" : undefined}
                onClick={() => select(account)}
                className={cn("flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-t1", collapsed && "justify-center")}
              >
                <Avatar seed={account.id} size={38} active={active} />
                {!collapsed && (
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[14px] font-bold">{account.name}</span>
                    <span className="text-[12px] whitespace-nowrap text-t4">{accountRole(account)}</span>
                  </div>
                )}
              </button>
              {!collapsed && withMenu && (
                <button
                  type="button"
                  aria-label={`Account menu for ${account.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === account.id}
                  onClick={() => setMenuFor((open) => (open === account.id ? null : account.id))}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-t4 hover:bg-btn"
                >
                  <Icon name="dots-three-vertical" weight="bold" />
                </button>
              )}
            </div>
            {menuFor === account.id && (
              <>
                <div aria-hidden className="fixed inset-0 z-(--z-menu-catcher)" onClick={() => setMenuFor(null)} />
                <Menu size="sm" label={`${account.name} menu`} className="absolute top-[calc(100%+4px)] right-1 z-(--z-popover)">
                  <MenuItem size="sm" icon="user" onSelect={() => void openProfile(account)}>
                    Profile
                  </MenuItem>
                  <MenuItem size="sm" icon="key" onSelect={() => (setMenuFor(null), void copyToken(account.id))}>
                    Copy token
                  </MenuItem>
                  <MenuItem size="sm" icon="sign-out" danger onSelect={() => (setMenuFor(null), void signOutAccount(account.id))}>
                    Sign out
                  </MenuItem>
                </Menu>
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        title="Add account"
        onClick={() => {
          onNavigate?.();
          openSignIn();
        }}
        className={cn(rowClass, "border-dashed border-(--color-dashed) bg-transparent text-[14px] font-semibold whitespace-nowrap text-t3", withMenu && "hover:bg-card")}
      >
        <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-btn">
          <Icon name="plus" size={16} />
        </span>
        {!collapsed && "Add account"}
      </button>
    </div>
  );
}

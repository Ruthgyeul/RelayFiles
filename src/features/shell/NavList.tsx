"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { activeNavItem, navItemsFor } from "./nav";

interface NavListProps {
  variant: "sidebar" | "drawer";
  isAdmin: boolean;
  collapsed?: boolean;
  /** Count shown in the orange badge (links expiring within 24 hours, File Manager). */
  expiringCount?: number;
  onNavigate?: () => void;
}

/** Section links: h44, radius 10, 15px 600; active = accentSoft / accentText. */
export function NavList({ variant, isAdmin, collapsed = false, expiringCount = 0, onNavigate }: NavListProps) {
  const pathname = usePathname();
  const current = activeNavItem(pathname);
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {navItemsFor(isAdmin).map((item) => {
        const active = item === current;
        const badge = item.id === "files" && expiringCount > 0;
        return (
          <Link
            key={item.id}
            href={item.href}
            title={item.label}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-[10px] text-left text-[15px] font-semibold whitespace-nowrap no-underline",
              variant === "sidebar" ? "px-3 hover:bg-nav-hover" : "px-3.5",
              active ? "bg-accent-soft text-accent-text hover:text-accent-text" : "bg-transparent text-t3 hover:text-t3",
            )}
          >
            <Icon name={item.icon} size={20} />
            {!collapsed && item.label}
            {badge && (
              <span
                title="Links expiring within 24 hours"
                className="ml-auto box-border flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-warn-orange px-1.5 text-[11px] font-extrabold text-warn-ink"
              >
                {expiringCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

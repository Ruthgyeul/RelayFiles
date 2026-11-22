import type { Route } from "next";
import type { IconName } from "@/shared/ui/icon/Icon";

export type NavId = "home" | "files" | "accounts" | "server" | "status" | "settings";

export interface NavItem {
  id: NavId;
  href: Route;
  label: string;
  icon: IconName;
  /** Header title for this section. */
  title: string;
  adminOnly?: boolean;
}

/**
 * Sidebar and drawer navigation in the design's order. `/files` is an
 * optional catch-all route, which the typed-route check only accepts with `as Route`.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", href: "/", label: "Home", icon: "house", title: "Home" },
  { id: "files", href: "/files" as Route, label: "File Manager", icon: "folder-simple", title: "root" },
  { id: "accounts", href: "/admin/accounts", label: "Accounts", icon: "users-three", title: "Accounts", adminOnly: true },
  { id: "server", href: "/admin/server", label: "Server", icon: "cpu", title: "Server", adminOnly: true },
  { id: "status", href: "/status", label: "Status", icon: "pulse", title: "Status" },
  { id: "settings", href: "/settings", label: "Settings", icon: "gear-six", title: "My Profile" },
];

export function navItemsFor(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

/** Section that owns a path: exact match for "/", prefix match otherwise. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)));
}

export interface FilesSubpage {
  href: Route;
  label: string;
  icon: IconName;
}

/** Pages of the File Manager outside the folder tree, linked from its toolbar in this order. */
export const FILES_SUBPAGES: readonly FilesSubpage[] = [
  { href: "/files/photos", label: "Photos", icon: "image" },
  { href: "/files/shared", label: "Shared by me", icon: "share-network" },
  { href: "/files/storage", label: "Storage", icon: "hard-drives" },
  { href: "/files/deleted", label: "Recently deleted", icon: "clock-counter-clockwise" },
];

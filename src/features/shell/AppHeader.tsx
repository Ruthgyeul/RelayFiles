import type { ReactNode } from "react";
import { Icon } from "@/shared/ui/icon/Icon";

/** Sticky 60px header: menu button, page title and an optional action (global search on Files). */
export function AppHeader({ title, onMenu, menuExpanded, action }: { title: string; onMenu: () => void; menuExpanded: boolean; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-(--z-header) flex h-[60px] items-center gap-4 border-b border-line bg-header px-4">
      <button
        type="button"
        aria-label="Toggle navigation"
        aria-expanded={menuExpanded}
        onClick={onMenu}
        className="flex size-10 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-nav-hover"
      >
        <Icon name="list" size={22} />
      </button>
      <h1 className="m-0 min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h1>
      {action}
    </header>
  );
}


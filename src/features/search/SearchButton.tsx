import { Kbd } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";

/**
 * Header button that opens the global search (File Manager only). Its accessible name is its
 * visible text (WCAG 2.5.3 "label in name"), kept for screen readers on phones where it is hidden.
 */
export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Search all files (Ctrl/⌘ K)"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-[38px] shrink-0 items-center gap-2.5 rounded-[10px] border border-ctrl bg-sunk pr-2.5 pl-3 text-[14px] font-medium text-t4 hover:border-accent-hi"
    >
      <Icon name="magnifying-glass" size={18} className="text-t3" />
      <span className="sr-only text-left sm:not-sr-only sm:inline sm:min-w-[120px]">Search files…</span>
      {/* The shortcut is announced through aria-keyshortcuts, not read as part of the name. */}
      <span aria-hidden className="hidden sm:inline-flex">
        <Kbd variant="hint">⌘K</Kbd>
      </span>
    </button>
  );
}

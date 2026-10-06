import { Kbd } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";

/** Header button that opens the global search (design `gsAvail`, File Manager only). */
export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Search all files (Ctrl/⌘ K)"
      aria-label="Search all files"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-[38px] shrink-0 items-center gap-2.5 rounded-[10px] border border-ctrl bg-sunk pr-2.5 pl-3 text-[14px] font-medium text-t4 hover:border-accent-hi"
    >
      <Icon name="magnifying-glass" size={18} className="text-t3" />
      <span className="hidden min-w-[120px] text-left sm:inline">Search files…</span>
      <Kbd variant="hint" className="hidden sm:inline-flex">
        ⌘K
      </Kbd>
    </button>
  );
}

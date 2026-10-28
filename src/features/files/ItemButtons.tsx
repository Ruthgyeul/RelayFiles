"use client";

import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

/** Row button: 40px tap target below 720px (label hidden), 30px with label above. */
export function RowButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="box-border flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-2.5 text-[13px] font-bold text-t1 hover:bg-btn-h sm:h-[30px] sm:min-w-[30px]"
    >
      <Icon name={icon} size={15} />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

export function MenuButton({ label, open, onMenu, className }: { label: string; open: boolean; onMenu: (anchor: HTMLElement) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onMenu(event.currentTarget);
      }}
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn sm:size-[30px]", className)}
    >
      <Icon name="dots-three-vertical" weight="bold" size={16} />
    </button>
  );
}

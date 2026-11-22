import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** A filter of a list page (Accounts, Shared by me): pill 32px, accent when on, `aria-pressed`. */
export function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-8 rounded-full border px-3 text-[13px] font-bold", on ? "border-accent-hi bg-accent-soft text-accent-text" : "border-card-line bg-card text-t3")}
    >
      {children}
    </button>
  );
}

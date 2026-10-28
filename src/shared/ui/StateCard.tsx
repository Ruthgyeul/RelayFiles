import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "./icon/Icon";

/** Centered 400px card of the public link pages' states (share links, upload links). */
export function StateCard({ icon, iconBox, iconColor, title, gap = "gap-3", children }: { icon: IconName; iconBox: string; iconColor: string; title: string; gap?: "gap-3" | "gap-3.5"; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6">
      <section aria-label={title} className={cn("flex w-[min(400px,100%)] flex-col items-center rounded-2xl border border-card-line bg-card px-6 py-7 text-center", gap)}>
        <span className={cn("flex size-14 items-center justify-center rounded-[14px]", iconBox)}>
          <Icon name={icon} weight="fill" size={26} className={iconColor} />
        </span>
        <h1 className="m-0 text-[19px] font-bold">{title}</h1>
        {children}
      </section>
    </div>
  );
}


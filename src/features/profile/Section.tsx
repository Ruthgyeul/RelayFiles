import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

/** 38px icon box + 17px title used by the profile sections (design). */
export function SectionTitle({ icon, box, color, children, after }: { icon: IconName; box: string; color: string; children: ReactNode; after?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={cn("flex size-[38px] shrink-0 items-center justify-center rounded-[10px]", box)}>
        <Icon name={icon} size={20} className={color} />
      </span>
      {children}
      {after}
    </div>
  );
}

/** Small card heading with a 32px icon box (Storage, Traffic, Content). */
export function CardTitle({ icon, box, color, children }: { icon: IconName; box: string; color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5 font-bold">
      <span className={cn("flex size-8 items-center justify-center rounded-[9px]", box)}>
        <Icon name={icon} className={color} />
      </span>
      {children}
    </span>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { TONE, type Tone } from "@/shared/styles/palette";
import { Icon, type IconName, type IconWeight } from "./icon/Icon";

export interface PillProps {
  children: ReactNode;
  /** Preset colors; use `bg`/`color` for one-off combinations from the design. */
  tone?: Tone;
  bg?: string;
  color?: string;
  icon?: IconName;
  iconWeight?: IconWeight;
  title?: string;
  className?: string;
}

/** Status badge: 10px, weight 800, letter-spacing .04em, fully rounded (e.g. COMPLETE, ADMIN, THIS DEVICE). */
export function Pill({ children, tone = "accent", bg, color, icon, iconWeight = "fill", title, className }: PillProps) {
  const style: CSSProperties = { background: bg ?? TONE[tone].bg, color: color ?? TONE[tone].text };
  return (
    <span
      title={title}
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.04em] whitespace-nowrap",
        className,
      )}
    >
      {icon && <Icon name={icon} weight={iconWeight} size={11} />}
      {children}
    </span>
  );
}

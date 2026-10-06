import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { TONE, type Tone } from "@/shared/styles/palette";
import { Icon, type IconName, type IconWeight } from "./icon/Icon";
import { IconButton } from "./IconButton";

export interface BannerProps {
  tone?: Tone;
  /** One-off colors from the design (override the tone preset). */
  bg?: string;
  border?: string;
  iconColor?: string;
  icon: IconName;
  iconWeight?: IconWeight;
  iconSize?: number;
  title?: ReactNode;
  titleColor?: string;
  children?: ReactNode;
  /** Body text color; most banners use t1, the account banner uses t2. */
  bodyClassName?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Vertical alignment of icon and body. */
  align?: "center" | "start";
  className?: string;
}

/** Inline notice used for account, announcement, expiry and quota messages (radius 14). */
export function Banner({
  tone = "accent",
  bg,
  border,
  iconColor,
  icon,
  iconWeight = "fill",
  iconSize = 20,
  title,
  titleColor,
  children,
  bodyClassName,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  align = "start",
  className,
}: BannerProps) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      style={{ background: bg ?? t.bg, borderColor: border ?? t.border }}
      className={cn(
        "flex flex-wrap gap-3 rounded-[14px] border py-3.5 pr-2.5 pl-4",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      <Icon name={icon} weight={iconWeight} size={iconSize} className={cn(align === "start" && "mt-px")} style={{ color: iconColor ?? t.icon }} />
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        {title && (
          <span className="text-[14px] font-bold" style={{ color: titleColor }}>
            {title}
          </span>
        )}
        {children && <span className={cn("text-[13px] leading-[1.45] text-pretty text-t1", bodyClassName)}>{children}</span>}
      </div>
      {(actions || onDismiss) && (
        <div className="flex items-center gap-1">
          {actions}
          {onDismiss && <IconButton icon="x" label={dismissLabel} size={32} iconSize={16} tone="t2" onClick={onDismiss} />}
        </div>
      )}
    </div>
  );
}

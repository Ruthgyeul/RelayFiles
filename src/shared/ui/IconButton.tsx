import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName, type IconWeight } from "./icon/Icon";

export type IconButtonSize = 28 | 30 | 32 | 34 | 36 | 40 | 44;

const SIZE: Record<IconButtonSize, string> = {
  28: "size-7",
  30: "size-[30px]",
  32: "size-8",
  34: "size-[34px]",
  36: "size-9",
  40: "size-10",
  44: "size-11",
};

const TONE = { t1: "text-t1", t2: "text-t2", t3: "text-t3", t4: "text-t4", danger: "text-danger-text" } as const;
const HOVER = { none: "", btn: "hover:bg-btn", btnH: "hover:bg-btn-h", nav: "hover:bg-nav-hover" } as const;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Accessible name; also used as the tooltip unless `title` is given. */
  label: string;
  size?: IconButtonSize;
  iconSize?: number;
  iconWeight?: IconWeight;
  tone?: keyof typeof TONE;
  hover?: keyof typeof HOVER;
}

/** Transparent square icon button (radius 8) used throughout the design's toolbars and dialogs. */
export function IconButton({
  icon,
  label,
  size = 32,
  iconSize = 18,
  iconWeight,
  tone = "t3",
  hover = "none",
  type = "button",
  title,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0",
        SIZE[size],
        TONE[tone],
        HOVER[hover],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} weight={iconWeight} />
    </button>
  );
}

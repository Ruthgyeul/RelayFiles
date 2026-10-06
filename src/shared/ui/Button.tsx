import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName, type IconWeight } from "./icon/Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-outline" | "danger-solid";

/** Heights used by the design (px). Each maps to the radius, padding and text size the design pairs with it. */
export type ButtonSize = 28 | 30 | 32 | 34 | 36 | 38 | 40 | 44;

const SIZE: Record<ButtonSize, string> = {
  28: "h-7 rounded-lg px-2.5 text-[12px]",
  30: "h-[30px] rounded-lg px-2.5 text-[12px]",
  32: "h-8 rounded-[10px] px-3 text-[13px]",
  34: "h-[34px] rounded-[10px] px-3 text-[13px]",
  36: "h-9 rounded-[10px] px-3.5 text-[13px]",
  38: "h-[38px] rounded-[10px] px-4 text-[14px]",
  40: "h-10 rounded-[10px] px-4 text-[14px]",
  44: "h-11 rounded-[10px] px-4 text-[15px]",
};

const VARIANT: Record<ButtonVariant, { base: string; hover: string }> = {
  primary: { base: "border border-accent bg-accent text-on-accent", hover: "hover:bg-accent-hi" },
  secondary: { base: "border border-ctrl bg-btn text-t1", hover: "hover:bg-btn-h" },
  ghost: { base: "border-0 bg-transparent text-t3", hover: "hover:bg-btn" },
  "danger-outline": { base: "border border-danger-line bg-transparent text-danger-text", hover: "hover:bg-danger-bg" },
  "danger-solid": { base: "border border-danger-solid bg-danger-solid text-white", hover: "" },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconWeight?: IconWeight;
  iconSize?: number;
  /** Apply the design's hover color. Only some buttons in the design have one. */
  hoverable?: boolean;
  /** Hide the text label below 720px (the design's `showLabels`), keeping only the icon. */
  hideLabelOnMobile?: boolean;
  children?: ReactNode;
}

/** Class names for a button-styled element (also used by ButtonLink). */
export function buttonClassName({ variant = "secondary", size = 32, hoverable = false }: { variant?: ButtonVariant; size?: ButtonSize; hoverable?: boolean }): string {
  const v = VARIANT[variant];
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 font-bold whitespace-nowrap no-underline disabled:cursor-not-allowed disabled:opacity-50",
    SIZE[size],
    v.base,
    hoverable && v.hover,
  );
}

export function Button({
  variant = "secondary",
  size = 32,
  icon,
  iconWeight,
  iconSize,
  hoverable = false,
  hideLabelOnMobile = false,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={cn(buttonClassName({ variant, size, hoverable }), className)} {...rest}>
      {icon && <Icon name={icon} weight={iconWeight} size={iconSize} />}
      {children != null && <span className={cn(hideLabelOnMobile && "max-sm:hidden")}>{children}</span>}
    </button>
  );
}

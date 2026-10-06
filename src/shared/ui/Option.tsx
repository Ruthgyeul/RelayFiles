import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName, type IconWeight } from "./icon/Icon";

interface SelectableProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  children: ReactNode;
}

const SELECTED = "border-accent-hi bg-accent-soft text-accent-text";

export interface OptionChipProps extends SelectableProps {
  /** `option` = settings choices (radius 10, h34); `filter` = list filters (fully rounded). */
  variant?: "option" | "filter";
  height?: 30 | 32 | 34;
  icon?: IconName;
  iconColor?: string;
  /** Trailing muted text, e.g. an item count. */
  count?: ReactNode;
}

/** One choice in a group of mutually exclusive options (the design's `opts()` buttons and filter chips). */
export function OptionChip({
  selected = false,
  variant = "option",
  height = variant === "option" ? 34 : 30,
  icon,
  iconColor,
  count,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: OptionChipProps) {
  const off =
    variant === "option"
      ? cn("border-ctrl bg-btn", disabled ? "text-t5" : "text-t2")
      : "border-card-line bg-card text-t2";
  return (
    <button
      type={type}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 border font-bold whitespace-nowrap",
        variant === "option" ? "rounded-[10px] px-3.5 text-[13px]" : "rounded-full px-3 text-[12px]",
        { 30: "h-[30px]", 32: "h-8", 34: "h-[34px]" }[height],
        selected && !disabled ? SELECTED : off,
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} style={{ color: selected ? undefined : iconColor }} />}
      {children}
      {count != null && <span className="opacity-65">{count}</span>}
    </button>
  );
}

export interface OptionCardProps extends SelectableProps {
  description?: ReactNode;
  icon?: IconName;
  iconWeight?: IconWeight;
  iconSize?: number;
  /** Icon color override (the sign-up mode cards always use accentHi). */
  iconColor?: string;
  /** Unselected surface: `btn` (visibility) or `elev` (sign-up modes). */
  surface?: "btn" | "elev";
}

/** A larger choice card with an icon, a title and a description line. */
export function OptionCard({
  selected = false,
  description,
  icon,
  iconWeight,
  iconSize = 18,
  iconColor,
  surface = "btn",
  type = "button",
  className,
  children,
  ...rest
}: OptionCardProps) {
  const off = surface === "btn" ? "border-ctrl bg-btn text-t2" : "border-ctrl bg-elev text-t1";
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left", selected ? SELECTED : off, className)}
      {...rest}
    >
      {icon && <Icon name={icon} weight={iconWeight} size={iconSize} className="mt-px" style={{ color: iconColor }} />}
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-bold">{children}</span>
        {description && <span className="text-[12px] text-t4">{description}</span>}
      </span>
    </button>
  );
}

export interface CheckRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  description?: ReactNode;
}

/** Checkbox row: square icon (22px, accentHi) + label, as used for toggles in the design's dialogs. */
export function CheckRow({ checked, onCheckedChange, children, description, type = "button", className, ...rest }: CheckRowProps) {
  return (
    <button
      type={type}
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex gap-2.5 border-0 bg-transparent p-0 text-left text-[14px] font-semibold text-t1",
        description ? "items-start" : "items-center",
        className,
      )}
      {...rest}
    >
      <Icon name={checked ? "check-square" : "square"} weight={checked ? "fill" : "regular"} size={22} className="text-accent-hi" />
      {description ? (
        <span className="flex flex-col gap-0.5">
          <span>{children}</span>
          <span className="text-[12px] font-normal text-t4">{description}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

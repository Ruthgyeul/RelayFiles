import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "./icon/Icon";

/** Pulsing placeholder block (bg btn, `skel` 1.4s). Size and radius come from the caller. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("block rounded-md bg-btn animate-skel", className)} style={style} />;
}

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueColor?: string;
  /** Value size: 18 (server tiles) or 20 (connection tiles). */
  valueSize?: 15 | 18 | 20;
  className?: string;
}

/** Sunk stat tile: radius 12, padding 12, uppercase label (11px/700/.04em). */
export function StatTile({ label, value, sub, valueColor, valueSize = 18, className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-[3px] rounded-xl bg-sunk p-3", className)}>
      <span className="text-[11px] font-bold tracking-[.04em] text-t4">{label}</span>
      <span className={cn("font-bold", { 15: "text-[15px]", 18: "text-[18px]", 20: "text-[20px]" }[valueSize])} style={{ color: valueColor }}>
        {value}
      </span>
      {sub && <span className="text-[12px] text-t4">{sub}</span>}
    </div>
  );
}

export interface MeterProps {
  /** 0–100. */
  value: number;
  height?: 4 | 6;
  color?: string;
  label?: string;
  animated?: boolean;
  className?: string;
}

/** Progress / usage bar on a `line` track. */
export function Meter({ value, height = 6, color = "var(--accent)", label, animated = false, className }: MeterProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("overflow-hidden bg-line", height === 4 ? "h-1 rounded-[2px]" : "h-1.5 rounded-[3px]", className)}
    >
      <div
        className={cn("h-full", height === 4 ? "rounded-[2px]" : "rounded-[3px]", animated && "transition-[width] duration-[600ms]")}
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export interface Bar {
  /** 0–100, or null when there is no data for this slot. */
  value: number | null;
  color?: string;
  opacity?: number;
  title?: string;
}

export interface BarChartProps {
  bars: Bar[];
  height: number;
  gap?: 2 | 3;
  /** Default bar color. */
  color?: string;
  /** Height of empty (no data) slots, as a CSS length. */
  emptyHeight?: string;
  /** Rounded top corners (charts) or fully rounded cells (uptime strips). */
  shape?: "column" | "cell";
  label?: string;
  className?: string;
}

/** Simple column chart / uptime strip. Slots without data render in the `btn` color, never fake values. */
export function BarChart({ bars, height, gap = 3, color = "var(--accent)", emptyHeight = "100%", shape = "column", label, className }: BarChartProps) {
  const hasData = bars.some((b) => b.value !== null);
  return (
    <div role="img" aria-label={label} className={cn("relative flex items-end", gap === 2 ? "gap-0.5" : "gap-[3px]", className)} style={{ height }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          title={bar.title}
          className={cn("flex-1 transition-[height] duration-[400ms]", shape === "column" ? "rounded-t-[2px]" : "rounded-[2px]")}
          style={
            bar.value === null
              ? { height: emptyHeight, background: "var(--btn)" }
              : { height: `${Math.min(100, Math.max(0, bar.value))}%`, background: bar.color ?? color, opacity: bar.opacity }
          }
        />
      ))}
      {!hasData && <NoData className="absolute inset-0" />}
    </div>
  );
}

/** "No data yet" placeholder for charts that have no history (no fabricated values). */
export function NoData({ className, children = "No data yet" }: { className?: string; children?: ReactNode }) {
  return <div className={cn("flex items-center justify-center text-[12px] text-t4", className)}>{children}</div>;
}

/** Keyboard key: `key` = shortcut list chip, `hint` = inline hint such as ⌘K / Esc. */
export function Kbd({ children, variant = "key", className }: { children: ReactNode; variant?: "key" | "hint"; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-ctrl border-b-2 font-mono text-[11px] font-semibold",
        variant === "key" ? "h-[22px] min-w-[22px] bg-btn px-1.5 text-t1" : "px-1.5 py-0.5 text-t3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const LOGO = {
  22: { box: "size-[22px] rounded-md", icon: 12 },
  28: { box: "size-7 rounded-lg", icon: 15 },
  64: { box: "size-16 rounded-[18px] shadow-logo", icon: 32 },
} as const;

/**
 * RelayFiles mark: accent square with a bold arrow-up-right. The 64px hero variant keeps
 * the design's white arrow (the prototype overrides onAccent with #fff there).
 */
export function Logo({ size, withText = false, className }: { size: keyof typeof LOGO; withText?: boolean; className?: string }) {
  const spec = LOGO[size];
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold", className)}>
      <span className={cn("flex shrink-0 items-center justify-center bg-accent", spec.box)}>
        <Icon name="arrow-up-right" weight="bold" size={spec.icon} className={size === 64 ? "text-white" : "text-on-accent"} />
      </span>
      {withText && "RelayFiles"}
    </span>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Empty list placeholder: 56px icon box, 16px title, 13px description, optional actions. */
export function EmptyState({ icon = "folder-open", title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 bg-card px-4 py-12 text-center", className)}>
      <span className="mb-1.5 flex size-14 items-center justify-center rounded-[14px] border border-ctrl bg-btn">
        <Icon name={icon} size={26} className="text-t4" />
      </span>
      <span className="text-[16px] font-bold">{title}</span>
      {description && <span className="text-[13px] text-t4">{description}</span>}
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </div>
  );
}

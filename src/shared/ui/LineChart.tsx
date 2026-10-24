import { useId } from "react";
import { areaPath, CHART_SCALE, linePath, lineSegments, slotCenter } from "@/domain/chart";
import { cn } from "@/shared/lib/cn";
import { NoData } from "./Display";

/** Opacity of the area fill right under the line; it fades to 0 at the baseline. */
const AREA_TOP_OPACITY = 0.28;
const STROKE_WIDTH = 2;

export interface LinePoint {
  /** 0–100, or null when there is no data for this slot. */
  value: number | null;
  title?: string;
}

export interface LineChartProps {
  points: LinePoint[];
  height: number;
  color?: string;
  /** Mark the newest point with a dot (live series). */
  markLast?: boolean;
  label?: string;
  className?: string;
}

/**
 * Line chart with a fading area fill. Slots without data break the line instead of
 * drawing fake values; a value between two gaps shows as a dot. Each slot keeps a
 * native `title` tooltip like the bar chart.
 */
export function LineChart({ points, height, color = "var(--accent)", markLast = false, label, className }: LineChartProps) {
  const gradientId = useId();
  const segments = lineSegments(points.map((point) => point.value));
  const dots = segments.filter((segment) => segment.length === 1).flat();
  const newest = segments.at(-1)?.at(-1);
  if (markLast && newest && typeof points.at(-1)?.value === "number" && !dots.includes(newest)) dots.push(newest);

  return (
    <div role="img" aria-label={label} className={cn("relative", className)} style={{ height }}>
      <svg aria-hidden viewBox={`0 0 ${CHART_SCALE} ${CHART_SCALE}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: color, stopOpacity: AREA_TOP_OPACITY }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <line x1="0" x2={CHART_SCALE} y1={CHART_SCALE} y2={CHART_SCALE} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--line)", strokeWidth: 1 }} />
        {segments.map((segment, index) => (
          <g key={index}>
            <path d={areaPath(segment)} fill={`url(#${gradientId})`} />
            <path d={linePath(segment)} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color, strokeWidth: STROKE_WIDTH }} />
          </g>
        ))}
      </svg>
      {dots.map((dot) => (
        <span
          key={dot.x}
          aria-hidden
          className="absolute size-[7px] -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-card"
          style={{ left: `${dot.x}%`, bottom: `${dot.y}%`, background: color }}
        />
      ))}
      <div className="absolute inset-0 flex">
        {points.map((point, index) => (
          <div key={slotCenter(index, points.length)} title={point.title} className="flex-1" />
        ))}
      </div>
      {segments.length === 0 && <NoData className="absolute inset-0" />}
    </div>
  );
}

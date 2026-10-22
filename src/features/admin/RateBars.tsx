import { formatSize } from "@/domain/format";
import type { RateSeries } from "@/domain/server";
import { BarChart } from "@/shared/ui/Display";

const PERCENT = 100;
/** Bars never shrink below this, so quiet hours stay visible (design). */
const MIN_BAR_PERCENT = 3;
const PAST_OPACITY = 0.55;
const HALF = 2;

/** Hourly rate columns, oldest first with the current hour highlighted, and the time axis (design `srvBw`). */
export function RateBars({ series, height, label, color, gap }: { series: RateSeries; height: number; label: string; color?: string; gap?: 2 | 3 }) {
  const last = series.hours.length - 1;
  const top = Math.max(0, ...series.hours.map((hour) => hour?.avg ?? 0));
  return (
    <>
      <BarChart
        height={height}
        label={label}
        color={color}
        gap={gap}
        bars={series.hours.map((hour, index) => {
          const when = index === last ? "This hour" : `${last - index}h ago`;
          if (hour === null) return { value: null, title: `${when} · No data` };
          return {
            value: Math.max(MIN_BAR_PERCENT, top > 0 ? (hour.avg / top) * PERCENT : 0),
            opacity: index === last ? 1 : PAST_OPACITY,
            title: `${when} · avg ${formatSize(hour.avg)}/s · peak ${formatSize(hour.peak)}/s`,
          };
        })}
      />
      <div className="flex justify-between text-[12px] text-t4">
        <span>{series.hours.length}h ago</span>
        <span>{series.hours.length / HALF}h ago</span>
        <span>now</span>
      </div>
    </>
  );
}

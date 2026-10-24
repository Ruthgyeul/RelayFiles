import { formatMetricSize } from "@/domain/format";
import type { RateSeries } from "@/domain/server";
import { LineChart } from "@/shared/ui/LineChart";

const PERCENT = 100;
const HALF = 2;

/** Hourly rate line, oldest first with the current hour marked, and the time axis (design `srvBw`). */
export function RateChart({ series, height, label, color }: { series: RateSeries; height: number; label: string; color?: string }) {
  const last = series.hours.length - 1;
  const top = Math.max(0, ...series.hours.map((hour) => hour?.avg ?? 0));
  return (
    <>
      <LineChart
        height={height}
        label={label}
        color={color}
        markLast
        points={series.hours.map((hour, index) => {
          const when = index === last ? "This hour" : `${last - index}h ago`;
          if (hour === null) return { value: null, title: `${when} · No data` };
          return {
            value: top > 0 ? (hour.avg / top) * PERCENT : 0,
            title: `${when} · avg ${formatMetricSize(hour.avg)}/s · peak ${formatMetricSize(hour.peak)}/s`,
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

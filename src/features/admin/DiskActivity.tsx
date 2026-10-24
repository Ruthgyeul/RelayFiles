import type { DiskActivity as DiskActivityDto } from "@/contracts/server-metrics";
import { formatMetricSize } from "@/domain/format";
import type { RateSeries } from "@/domain/server";
import { NoData } from "@/shared/ui/Display";
import { RateChart } from "./RateChart";

const CHART_HEIGHT = 80;
const READ_COLOR = "var(--accent)";
const WRITE_COLOR = "var(--color-warn-orange)";

function DiskRate({ disk, label, done, series, color }: { disk: string; label: string; done: string; series: RateSeries; color: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px]">
        <span className="flex items-center gap-1.5 font-bold text-t2">
          <span className="size-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="text-t4">
          avg {formatMetricSize(series.avg)}/s · peak {formatMetricSize(series.peak)}/s · {formatMetricSize(series.total)} {done}
        </span>
      </div>
      <RateChart series={series} height={CHART_HEIGHT} color={color} label={`${disk} ${label.toLowerCase()} rate, last ${series.hours.length} hours`} />
    </div>
  );
}

/** Read and write rate of each physical disk, one line point per hour (measured by the worker). */
export function DiskActivity({ disks, hours }: { disks: DiskActivityDto[]; hours: number }) {
  return (
    <section aria-label="Disk activity" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <h2 className="m-0 text-[17px] font-bold">Disk read / write · last {hours}h</h2>
      {disks.length === 0 && <NoData className="h-20 rounded-xl bg-sunk">No disk activity recorded yet</NoData>}
      {disks.map((disk) => (
        <div key={disk.name} className="flex flex-col gap-2.5 border-t border-card-line pt-3.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[14px] font-bold">{disk.name}</span>
            {disk.model && <span className="truncate text-[12px] text-t4">{disk.model}</span>}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
            <DiskRate disk={disk.name} label="Read" done="read" series={disk.read} color={READ_COLOR} />
            <DiskRate disk={disk.name} label="Write" done="written" series={disk.write} color={WRITE_COLOR} />
          </div>
        </div>
      ))}
    </section>
  );
}

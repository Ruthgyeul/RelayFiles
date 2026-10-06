import type { ProfileData } from "@/contracts/profile";
import { formatSize } from "@/domain/format";
import { quotaMeter } from "@/domain/quota";
import { METER_COLOR } from "@/features/shell/StorageMeter";
import { THEME_COLOR } from "@/shared/styles/palette";
import { BarChart } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { CardTitle } from "./Section";

const card = "flex flex-col gap-3 rounded-2xl border border-card-line bg-card p-[18px]";
const PERCENT = 100;

function ContentTile({ icon, color, value, label }: { icon: "file" | "folder-simple"; color: string; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-ctrl bg-elev p-3">
      <Icon name={icon} className={color} />
      <span className="text-[20px] font-bold">{value}</span>
      <span className="text-[12px] text-t4">{label}</span>
    </div>
  );
}

/** Storage, 30-day traffic and content counts (design profile grid). */
export function UsageCards({ data }: { data: ProfileData }) {
  const used = Number(data.usage.usedBytes);
  const quota = data.account.quotaBytes === null ? null : Number(data.account.quotaBytes);
  const meter = quotaMeter(used, quota);
  const days = data.traffic.days.map(Number);
  const peak = Math.max(...days);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      <section aria-label="Storage" className={card}>
        <CardTitle icon="hard-drives" box="bg-warn-bg-orange" color="text-warn-orange">
          Storage
        </CardTitle>
        <span className="text-[26px] font-bold">
          {formatSize(used)}
          <span className="text-[13px] font-medium text-t4"> / {quota === null ? "Unlimited" : formatSize(quota)}</span>
        </span>
        <div className="h-1.5 rounded-[3px] bg-line" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={Math.round(meter.percent)}>
          <div className="h-1.5 rounded-[3px]" style={{ width: `${meter.percent.toFixed(1)}%`, background: METER_COLOR[meter.tone] }} />
        </div>
        <span className="text-[12px] text-t4">{quota === null ? "No storage limit on this account." : "Storage limit set by the server admin."}</span>
      </section>
      <section aria-label="Traffic" className={card}>
        <CardTitle icon="gauge" box="bg-accent-soft" color="text-accent-icon">
          Traffic<span className="text-[12px] font-medium text-t4">last 30 days</span>
        </CardTitle>
        <span className="text-[26px] font-bold">{formatSize(Number(data.traffic.total))}</span>
        <BarChart
          height={44}
          gap={2}
          color={THEME_COLOR.accentHi}
          label="Bytes downloaded per day, last 30 days"
          bars={days.map((bytes) => ({ value: peak > 0 ? (bytes / peak) * PERCENT : null, title: formatSize(bytes) }))}
        />
      </section>
      <section aria-label="Content" className={card}>
        <CardTitle icon="copy" box="bg-cyan-bg" color="text-cyan">
          Content
        </CardTitle>
        <div className="grid grid-cols-2 gap-2">
          <ContentTile icon="file" color="text-kind-audio" value={data.usage.files} label="Files" />
          <ContentTile icon="folder-simple" color="text-kind-folder" value={data.usage.folders} label="Folders" />
        </div>
      </section>
    </div>
  );
}

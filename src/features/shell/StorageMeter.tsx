import type { SessionAccount, SessionState } from "@/contracts/auth";
import { formatSize } from "@/domain/format";
import { quotaMeter } from "@/domain/quota";
import { FIXED_COLOR } from "@/shared/styles/palette";

/** Design `quotaColor`: accent, #f5a142 at 70%, #ff6b7d at 90%. */
export const METER_COLOR = { accent: "var(--accent)", warn: FIXED_COLOR.warnOrange, danger: FIXED_COLOR.dangerIcon } as const;

/** "Storage  1.2 GB / 5.0 GB" with a 4px meter at the bottom of the sidebar and drawer. */
export function StorageMeter({ account, usage }: { account: SessionAccount | null; usage: SessionState["usage"] }) {
  const used = Number(usage?.usedBytes ?? 0);
  const quota = account?.quotaBytes ? Number(account.quotaBytes) : null;
  const meter = quotaMeter(used, quota);
  return (
    <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <div className="flex justify-between text-[12px] whitespace-nowrap text-t4">
        <span>Storage</span>
        <span>
          {formatSize(used)} / {quota === null ? "Unlimited" : formatSize(quota)}
        </span>
      </div>
      <div className="h-1 rounded-sm bg-line" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.percent)}>
        <div className="h-1 rounded-sm" style={{ width: `${meter.percent.toFixed(1)}%`, background: METER_COLOR[meter.tone] }} />
      </div>
    </div>
  );
}

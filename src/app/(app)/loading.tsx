import { Skeleton } from "@/shared/ui/Display";

/** Row widths of the design's boot skeleton (`SKEL`). */
const ROWS = [62, 48, 70, 40, 56, 66].map((w, i) => ({ w1: `${w}%`, w2: `${24 + ((i * 13) % 22)}%` }));

/** Shown while a page loads: the design's boot skeleton (header card, toolbar, six rows). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5 rounded-2xl border border-card-line bg-card px-5 py-[18px]">
        <Skeleton className="size-12 shrink-0 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-[18px] w-[38%] rounded-md" />
          <Skeleton className="h-3 w-[58%] rounded-md" />
        </div>
        <Skeleton className="h-[34px] w-[84px] rounded-[10px]" />
      </div>
      <div className="flex h-[52px] items-center gap-2 rounded-2xl border border-card-line bg-card px-3">
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-[30px] w-[86px] rounded-[10px]" />
        <Skeleton className="h-[30px] w-24 rounded-[10px]" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-card-line bg-card-line">
        {ROWS.map((row) => (
          <div key={row.w1} className="flex items-center gap-3 bg-card px-4 py-3.5">
            <Skeleton className="size-[22px] shrink-0 rounded-md" />
            <Skeleton className="size-[30px] shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 rounded-md" style={{ width: row.w1 }} />
              <Skeleton className="h-2.5 rounded-[5px]" style={{ width: row.w2 }} />
            </div>
            <Skeleton className="h-[30px] w-[72px] shrink-0 rounded-[10px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

import type { BusyBadge } from "@/domain/share";
import { cn } from "@/shared/lib/cn";
import { Icon } from "./icon/Icon";

/** "Busy" / "Server busy" badge next to a file name (design `busyShow`), with the reason as a tooltip. */
export function BusyPill({ busy }: { busy: BusyBadge }) {
  const paused = busy.level === 2;
  return (
    <span
      title={busy.tip}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-0.5 text-[10px] font-extrabold tracking-[.03em] whitespace-nowrap uppercase",
        paused ? "bg-danger-bg text-danger-text" : "bg-warn-bg-soft text-warn-text",
      )}
    >
      <Icon name={paused ? "traffic-signal" : "gauge"} weight="fill" size={11} />
      {busy.label}
    </span>
  );
}

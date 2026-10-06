import type { StatusComponentDto } from "@/contracts/status";
import { COMPONENT_STATE_LABEL, componentState, DAY_TEXT, formatDayKey, uptimeText, type ComponentState, type DayLevel, type StatusLevel } from "@/domain/status";
import { cn } from "@/shared/lib/cn";
import { BarChart } from "@/shared/ui/Display";

const PERCENT = 100;

const STATE_PILL: Record<ComponentState, string> = {
  operational: "bg-ok-bg text-ok-text",
  slow: "bg-warn-bg-soft text-warn-text",
  outage: "bg-danger-bg text-danger-text",
  unreachable: "bg-danger-bg text-danger-text",
  nodata: "bg-btn text-t3",
};

const DAY_COLOR: Record<Exclude<DayLevel, "nodata">, string> = { ok: "var(--color-ok-bar)", warn: "var(--color-warn-strong)", down: "var(--color-danger-icon)" };

/** Services with their current state, uptime and the last 60 days (design `st.comps`). */
export function ServicesCard({ components, level }: { components: StatusComponentDto[]; level: StatusLevel }) {
  return (
    <section aria-label="Services" className="flex flex-col gap-1 rounded-2xl border border-card-line bg-card p-5">
      <h2 className="m-0 mb-2 text-[17px] font-bold">Services</h2>
      {components.map((component) => {
        const state = componentState(component.key, level, component.latestOk);
        return (
          <div key={component.key} data-service={component.key} className="flex flex-col gap-2 border-t border-card-line py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[14px] font-bold">{component.name}</span>
              <span className="flex-1 text-[12px] text-t4">{component.detail}</span>
              <span className="text-[12px] text-t3">{uptimeText(component.uptime)}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-[.04em]", STATE_PILL[state])}>{COMPONENT_STATE_LABEL[state]}</span>
            </div>
            <BarChart
              height={22}
              gap={2}
              shape="cell"
              label={`${component.name}, last ${component.days.length} days`}
              bars={component.days.map(({ day, level: dayLevel }) => ({
                value: dayLevel === "nodata" ? null : PERCENT,
                color: dayLevel === "nodata" ? undefined : DAY_COLOR[dayLevel],
                title: `${formatDayKey(day)} · ${DAY_TEXT[dayLevel]}`,
              }))}
            />
          </div>
        );
      })}
      <div className="flex justify-between text-[11px] text-t4">
        <span>60 days ago</span>
        <span>Today</span>
      </div>
    </section>
  );
}

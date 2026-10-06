import type { IncidentDto } from "@/contracts/status";
import { formatDayKey, incidentWhen, SEVERITY_LABEL, type IncidentSeverity } from "@/domain/status";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";

const SEVERITY_PILL: Record<IncidentSeverity, string> = {
  minor: "bg-warn-bg-soft text-warn-text",
  major: "bg-danger-bg text-danger-text",
  maint: "bg-info-bg text-info-text",
};

interface IncidentsCardProps {
  incidents: IncidentDto[];
  isAdmin: boolean;
  onNew: () => void;
  onEdit: (incident: IncidentDto) => void;
  onDelete: (incident: IncidentDto) => void;
}

/** Incident history; admins post, edit and delete (design `st.incidents`). */
export function IncidentsCard({ incidents, isAdmin, onNew, onEdit, onDelete }: IncidentsCardProps) {
  return (
    <section aria-label="Incidents" className="flex flex-col gap-2.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex items-center gap-2.5">
        <h2 className="m-0 flex-1 text-[17px] font-bold">Incidents</h2>
        {isAdmin && (
          <button type="button" onClick={onNew} className="flex h-8 items-center gap-1.5 rounded-[10px] border border-accent bg-accent px-3 text-[13px] font-bold text-on-accent">
            <Icon name="plus" />
            Post incident
          </button>
        )}
      </div>
      {incidents.map((incident) => (
        <article key={incident.id} aria-label={incident.title} className="flex flex-col gap-1 border-t border-card-line py-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[14px] font-bold">{incident.title}</span>
            <span className={cn("rounded-full px-[7px] py-0.5 text-[10px] font-extrabold", SEVERITY_PILL[incident.severity])}>{SEVERITY_LABEL[incident.severity].badge}</span>
            {isAdmin && (
              <>
                <IconButton icon="pencil-simple" label={`Edit ${incident.title}`} title="Edit" size={28} iconSize={16} onClick={() => onEdit(incident)} />
                <IconButton icon="trash" label={`Delete ${incident.title}`} title="Delete" size={28} iconSize={16} tone="danger" onClick={() => onDelete(incident)} />
              </>
            )}
          </div>
          <span className="text-[12px] text-t4">{incidentWhen(formatDayKey(incident.date, true), incident.duration, incident.resolved)}</span>
          {incident.text && <span className="text-[13px] leading-[1.45] text-pretty text-t2">{incident.text}</span>}
        </article>
      ))}
      {incidents.length === 0 && <span className="py-2 text-[13px] text-t4">No incidents reported.</span>}
    </section>
  );
}

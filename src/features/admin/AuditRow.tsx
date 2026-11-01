"use client";

import type { AuditEntry } from "@/contracts/admin";
import { auditActionLabel, auditTargetText } from "@/domain/audit";
import { formatDateTime } from "@/domain/format";
import { LocalDate } from "@/shared/ui/LocalDate";

/** One audit entry: what was done, by whom, about what, when and from which (masked) address. */
export function AuditRow({ entry, onActor }: { entry: AuditEntry; onActor: (accountId: string) => void }) {
  const target = auditTargetText(entry);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-ctrl py-2.5 first:border-t-0">
      <div className="flex min-w-[min(220px,100%)] flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-bold">{auditActionLabel(entry.action)}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-t4">
          by
          <button
            type="button"
            title="Show this account's entries"
            onClick={() => onActor(entry.actorId)}
            className="rounded-md border-0 bg-transparent p-0 text-[12px] font-semibold text-t2"
          >
            {entry.actorName}
          </button>
          {target && <span className="min-w-0 font-mono break-all text-t3">{target}</span>}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right text-[12px] text-t4 max-sm:items-start max-sm:text-left">
        <LocalDate value={entry.at} format={formatDateTime} />
        <span className="font-mono">{entry.ipMasked}</span>
      </div>
    </li>
  );
}

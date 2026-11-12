"use client";

import { SECURITY_LOG } from "@/config/policy";
import type { SecurityLogEntry } from "@/contracts/profile";
import { formatDateTime } from "@/domain/format";
import { isSecurityWarning, securityEventLabel, securityEventOrigin } from "@/domain/security-log";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { SectionTitle } from "./Section";
import { useSecurityLog } from "./useSecurityLog";

/** One entry: what happened (a warning for refused tokens), the detail, where from and when. */
function SecurityLogRow({ entry }: { entry: SecurityLogEntry }) {
  const warning = isSecurityWarning(entry.kind);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-ctrl py-2.5 first:border-t-0">
      <div className="flex min-w-[min(220px,100%)] flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[14px] font-bold">
          {warning && <Icon name="warning" size={15} className="shrink-0 text-warn-strong" />}
          {securityEventLabel(entry.kind)}
        </span>
        {entry.detail && <span className="text-[12px] break-all text-t3">{entry.detail}</span>}
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right text-[12px] text-t4 max-sm:items-start max-sm:text-left">
        <LocalDate value={entry.at} format={formatDateTime} />
        <span className="font-mono">{securityEventOrigin(entry)}</span>
      </div>
    </li>
  );
}

/**
 * "Security log": sign-ins, sign-outs and token changes of this account, newest first.
 * `changes` counts the actions done on the profile, so they show up right away.
 */
export function SecurityLogCard({ changes }: { changes: number }) {
  const log = useSecurityLog(changes);
  return (
    <section aria-label="Security log" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <SectionTitle icon="shield-check" box="bg-accent-soft" color="text-accent-icon">
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Security log</h2>
          <span className="text-[12px] text-pretty text-t4">
            Sign-ins and token changes from the last {SECURITY_LOG.retentionDays} days. Addresses are stored masked. A wrong token typed at sign-in matches no account, so it is not listed here.
          </span>
        </div>
      </SectionTitle>
      <div className="flex flex-col rounded-xl border border-ctrl bg-elev px-3.5 py-1">
        {log.events.length > 0 && (
          <ol aria-label="Security log entries" className="m-0 flex list-none flex-col p-0">
            {log.events.map((entry) => (
              <SecurityLogRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
        {log.events.length === 0 && log.status === "ready" && <span className="py-6 text-center text-[13px] text-t4">Nothing recorded yet.</span>}
        {log.events.length === 0 && log.status === "loading" && <span className="py-6 text-center text-[13px] text-t4">Loading…</span>}
        {log.status === "error" && (
          <div className="flex flex-wrap items-center justify-center gap-2.5 py-4 text-[13px] text-t4">
            Couldn&apos;t load the security log.
            <Button size={30} icon="arrows-clockwise" onClick={log.retry}>
              Retry
            </Button>
          </div>
        )}
      </div>
      {log.hasMore && log.status !== "error" && (
        <Button size={36} hoverable disabled={log.status === "loading"} onClick={log.loadMore} className="self-center">
          Load more
        </Button>
      )}
    </section>
  );
}

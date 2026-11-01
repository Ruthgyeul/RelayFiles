"use client";

import { useState } from "react";
import { AUTH } from "@/config/policy";
import { AUDIT_GROUPS, type AuditGroup } from "@/domain/audit";
import { isAccountId } from "@/domain/ids";
import { Button } from "@/shared/ui/Button";
import { TextInput } from "@/shared/ui/Field";
import { Icon } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";
import { OptionChip } from "@/shared/ui/Option";
import { AuditRow } from "./AuditRow";
import { useAuditLog } from "./useAuditLog";

/**
 * "Audit log": admin actions, newest first, filtered by group and account, one page at a time.
 * `changes` counts the actions saved on this page, so the log shows them right away.
 */
export function AuditCard({ changes }: { changes: number }) {
  const [group, setGroup] = useState<AuditGroup | undefined>(undefined);
  const [accountText, setAccountText] = useState("");
  const account = accountText.trim();
  const accountValid = account === "" || isAccountId(account);
  const log = useAuditLog({ group, account: account && accountValid ? account : undefined, changes });

  return (
    <section aria-label="Audit log" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="shield-check" size={20} className="text-accent-icon" />
        </span>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Audit log</h2>
          <span className="text-[12px] text-pretty text-t4">Admin actions from the last {AUTH.auditRetentionDays} days. Addresses are stored masked.</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Action" className="flex flex-wrap gap-1.5">
          <OptionChip variant="filter" selected={group === undefined} onClick={() => setGroup(undefined)}>
            All
          </OptionChip>
          {AUDIT_GROUPS.map((entry) => (
            <OptionChip key={entry.key} variant="filter" selected={group === entry.key} onClick={() => setGroup(entry.key)}>
              {entry.label}
            </OptionChip>
          ))}
        </div>
        <span className="flex-1" />
        <div className="flex min-w-0 flex-[1_1_200px] items-center gap-1 sm:max-w-[260px]">
          <TextInput
            height={36}
            mono
            value={accountText}
            onChange={(event) => setAccountText(event.target.value)}
            placeholder="Account ID"
            aria-label="Account ID"
            aria-invalid={!accountValid}
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          {accountText && <IconButton icon="x" label="Clear account" size={32} iconSize={16} onClick={() => setAccountText("")} />}
        </div>
      </div>
      {!accountValid && <span className="text-[12px] text-danger-text">Account IDs are 12 letters and digits.</span>}
      <div className="flex flex-col rounded-xl border border-ctrl bg-elev px-3.5 py-1">
        {log.events.length > 0 && (
          <ol aria-label="Audit entries" className="m-0 flex list-none flex-col p-0">
            {log.events.map((entry) => (
              <AuditRow key={entry.id} entry={entry} onActor={setAccountText} />
            ))}
          </ol>
        )}
        {log.events.length === 0 && log.status === "ready" && <span className="py-6 text-center text-[13px] text-t4">No entries match.</span>}
        {log.events.length === 0 && log.status === "loading" && <span className="py-6 text-center text-[13px] text-t4">Loading…</span>}
        {log.status === "error" && (
          <div className="flex flex-wrap items-center justify-center gap-2.5 py-4 text-[13px] text-t4">
            Couldn&apos;t load the audit log.
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

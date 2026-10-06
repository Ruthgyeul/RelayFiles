"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminAccounts, ManageInput } from "@/contracts/admin";
import { accountStatus, ADMIN_FILTERS, matchesFilter, type AdminFilter } from "@/domain/admin";
import { formatSize } from "@/domain/format";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { useMounted } from "@/shared/hooks/useMounted";
import { useNow } from "@/shared/hooks/useNow";
import { ApiClientError } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { AccountRow } from "./AccountRow";
import { adminApi } from "./api";
import { ManageDialog } from "./ManageDialog";

/** Rows rendered at a time; filters and search still cover every account. */
const PAGE_SIZE = 50;

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

function StatCard({ icon, box, color, label, value }: { icon: IconName; box: string; color: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-card-line bg-card p-4">
      <span className="flex items-center gap-2.5 text-[13px] font-bold text-t2">
        <span className={cn("flex size-[30px] items-center justify-center rounded-lg", box)}>
          <Icon name={icon} className={color} />
        </span>
        {label}
      </span>
      <span className="text-[24px] font-bold">{value}</span>
    </div>
  );
}

/** Admin "Accounts" page (design `isAdmin`): stats, cleanup, filters, search and account rows. */
export function AccountsPage({ data }: { data: AdminAccounts }) {
  usePageTitle("Accounts");
  const router = useRouter();
  const { notify } = useShell();
  const now = useNow(false);
  const mounted = useMounted();
  const [filter, setFilter] = useState<AdminFilter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [manageId, setManageId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data.accounts.map((account) => ({
    account,
    ...accountStatus({ createdAt: Date.parse(account.createdAt), expiresAt: account.expiresAt ? Date.parse(account.expiresAt) : null, isAdmin: account.isAdmin, neverExpire: account.neverExpire }, data.ttlDays, now),
  }));
  const count = (key: AdminFilter) => rows.filter((row) => matchesFilter(row.status, key)).length;
  const query = search.trim().toLowerCase();
  const visible = rows
    .filter((row) => matchesFilter(row.status, filter) && (!query || row.account.name.includes(query) || row.account.id.includes(query)))
    .sort((a, b) => Number(b.account.isAdmin) - Number(a.account.isAdmin) || a.left - b.left);
  const managed = data.accounts.find((account) => account.id === manageId) ?? null;
  const deleting = data.accounts.find((account) => account.id === deleteId) ?? null;
  const admins = data.accounts.filter((account) => account.isAdmin).length;

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      notify(await action());
      router.refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const save = (input: ManageInput) =>
    void run(async () => {
      await adminApi.manage(manageId!, input);
      setManageId(null);
      return "Account updated";
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <StatCard icon="users-three" box="bg-accent-soft" color="text-accent-icon" label="Accounts" value={String(rows.length)} />
        <StatCard icon="hard-drives" box="bg-warn-bg-orange" color="text-warn-orange" label="Storage used" value={formatSize(data.accounts.reduce((sum, account) => sum + Number(account.usedBytes), 0))} />
        <StatCard icon="hourglass-medium" box="bg-warn-bg-soft" color="text-warn-text" label="Expiring in 7 days" value={String(count("soon"))} />
        <StatCard icon="trash" box="bg-danger-bg" color="text-danger-text" label="Pending deletion" value={String(count("expired"))} />
      </div>
      <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-card-line bg-card px-3.5 py-3 text-[13px] leading-[1.5] text-pretty text-t2">
        <Icon name="info" size={18} className="text-accent-icon" />
        <span className="min-w-[220px] flex-1">
          Member accounts are deleted with all of their files 14 days after they are created, regardless of activity. Admins are exempt. Extend or exempt an account from Manage. File contents are private to each account and are not shown here.
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { accounts, items } = await adminApi.cleanup();
              if (accounts === 0 && items === 0) return "Nothing to clean up";
              return items === 0 ? `${accounts} account(s) deleted` : `${accounts} account(s) and ${items} expired item(s) deleted`;
            })
          }
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-3 text-[13px] font-bold text-t1"
        >
          <Icon name="broom" />
          Run cleanup now
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ADMIN_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => (setFilter(key), setShown(PAGE_SIZE))}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] font-bold",
              filter === key ? "border-accent-hi bg-accent-soft text-accent-text" : "border-card-line bg-card text-t3",
            )}
          >
            {label} {count(key)}
          </button>
        ))}
        <span className="flex-1" />
        <label className="flex h-9 min-w-[200px] items-center gap-2 rounded-[10px] border border-ctrl bg-card px-3">
          <Icon name="magnifying-glass" className="text-t4" />
          <input
            value={search}
            onChange={(event) => (setSearch(event.target.value), setShown(PAGE_SIZE))}
            placeholder="Search name or ID"
            aria-label="Search name or ID"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-t1 outline-none"
          />
        </label>
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-card-line bg-card-line">
        {visible.slice(0, shown).map(({ account }) => (
          <AccountRow
            key={account.id}
            account={account}
            ttlDays={data.ttlDays}
            now={now}
            mounted={mounted}
            onCopyId={() => {
              navigator.clipboard?.writeText(account.id).catch(() => undefined);
              notify("ID copied");
            }}
            onManage={() => setManageId(account.id)}
            onDelete={() => setDeleteId(account.id)}
          />
        ))}
        {visible.length === 0 && <div className="bg-card px-4 py-10 text-center text-[14px] text-t4">No accounts match.</div>}
      </div>
      {visible.length > shown && (
        <button type="button" onClick={() => setShown((count) => count + PAGE_SIZE)} className="h-9 self-center rounded-[10px] border border-ctrl bg-btn px-4 text-[13px] font-bold text-t1 hover:bg-btn-h">
          Show more · {visible.length - shown} left
        </button>
      )}

      {managed && (
        <ManageDialog
          key={managed.id}
          account={managed}
          ttlDays={data.ttlDays}
          now={now}
          lastAdmin={managed.isAdmin && admins === 1}
          busy={busy}
          onSave={save}
          onClose={() => setManageId(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="The account and all of its files are deleted permanently. This can't be undone."
        confirmLabel="Delete account"
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            await adminApi.deleteAccount(deleteId!);
            setDeleteId(null);
            return "Account deleted";
          })
        }
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

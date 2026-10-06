"use client";

import type { ProfileData } from "@/contracts/profile";
import { daysLeftUntil, retentionText } from "@/domain/account";
import { formatLongDate } from "@/domain/format";
import { useShell } from "@/features/shell/ShellProvider";
import { useMounted } from "@/shared/hooks/useMounted";
import { useNow } from "@/shared/hooks/useNow";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";

/** Avatar, name, role, id, dates, deletion countdown and Sign out (design profile card). */
export function ProfileCard({ account }: { account: ProfileData["account"] }) {
  const { notify, signOutAccount } = useShell();
  const now = useNow(false);
  const mounted = useMounted();
  const exempt = account.isAdmin || account.neverExpire;
  return (
    <>
      <section aria-label="Profile" className="flex flex-wrap items-center gap-[18px] rounded-2xl border border-card-line bg-card p-[22px]">
        <Avatar seed={account.id} size={68} bordered />
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-[24px] font-bold">{account.name}</h2>
            <span className="flex items-center gap-[5px] rounded-full border border-ctrl bg-btn px-2.5 py-[3px] text-[12px] font-bold text-t2">
              <Icon name="user" />
              {account.isAdmin ? "Admin" : "Anonymous"}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-t4">
            <button
              type="button"
              title="Copy ID"
              onClick={() => {
                navigator.clipboard?.writeText(account.id).catch(() => undefined);
                notify("ID copied");
              }}
              className="flex items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[13px] text-t3"
            >
              <Icon name="identification-card" />
              {account.id}
              <Icon name="copy" size={12} />
            </button>
            <span className="flex items-center gap-1.5">
              <Icon name="calendar-blank" />
              Created <LocalDate value={account.createdAt} format={formatLongDate} />
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="sign-in" />
              Last sign-in <LocalDate value={account.lastLoginAt} format={formatLongDate} />
            </span>
            {exempt ? (
              <span className="flex items-center gap-1.5 text-ok-text">
                <Icon name="shield-check" />
                Never expires
              </span>
            ) : (
              account.deletesAt && (
                <span className="flex items-center gap-1.5 text-warn-strong">
                  <Icon name="hourglass-medium" />
                  Deletes <LocalDate value={account.deletesAt} format={formatLongDate} /> · {mounted ? daysLeftUntil(Date.parse(account.deletesAt), now) : ""} days left
                </span>
              )
            )}
          </div>
        </div>
        <Button size={38} icon="sign-out" onClick={() => void signOutAccount(account.id)} className="text-danger-text">
          Sign out
        </Button>
      </section>
      <div className="flex items-center gap-2.5 rounded-[14px] border border-card-line bg-card px-4 py-3 text-[13px] leading-[1.5] text-pretty text-t2">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-warn-bg-soft">
          <Icon name="key" className="text-warn-strong" />
        </span>
        {retentionText(account, mounted && account.deletesAt ? formatLongDate(account.deletesAt) : "")}
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { formatShortDate, formatSize } from "@/domain/format";
import { quotaLevel, usedPercent } from "@/domain/quota";
import { useOnline } from "@/shared/hooks/useOnline";
import { buttonClassName } from "@/shared/ui/Button";
import { Banner } from "@/shared/ui/Banner";
import { Button } from "@/shared/ui/Button";
import type { AnnouncementDto } from "@/contracts/server-settings";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { useShell } from "./ShellProvider";

/**
 * Notices above the page content, in the design's order: the account created for this
 * visit, the admin announcement (File Manager), storage quota, then connectivity.
 */
export function BannerStack({ announcement }: { announcement: AnnouncementDto | null }) {
  const { session, activeAccount, autoAccountId, dismissAutoAccount, saveToken } = useShell();
  const pathname = usePathname();
  const online = useOnline();
  const [quotaDismissed, setQuotaDismissed] = useState<string | null>(null);

  const auto = autoAccountId && activeAccount?.id === autoAccountId ? activeAccount : null;
  const used = Number(session.usage?.usedBytes ?? 0);
  const quota = activeAccount?.quotaBytes ? Number(activeAccount.quotaBytes) : null;
  const level = quotaLevel(used, quota);
  const quotaKey = `${level}:${activeAccount?.id}`;

  return (
    <>
      {auto && (
        <Banner
          tone="accent"
          icon="user-circle-plus"
          iconSize={22}
          align="center"
          title={`You're signed in as ${auto.name}`}
          bodyClassName="text-t2"
          actions={
            <Button variant="primary" size={34} icon="key" className="px-3.5" onClick={() => void saveToken(auto.id).then(dismissAutoAccount)}>
              Save token
            </Button>
          }
          onDismiss={dismissAutoAccount}
        >
          An anonymous account was created for this visit. Save its token to come back later.
          {auto.deletesAt && ` It's deleted with its files on ${formatShortDate(auto.deletesAt)}.`}
        </Banner>
      )}
      {announcement && pathname.startsWith("/files") && <AnnouncementBanner announcement={announcement} />}
      {level > 0 && quotaDismissed !== quotaKey && quota !== null && (
        <Banner
          tone={level === 2 ? "danger" : "warn"}
          icon="warning"
          title={level === 2 ? "Storage is full" : "Storage almost full"}
          titleColor={level === 2 ? "var(--color-danger-text)" : "var(--color-warn-text)"}
          iconColor={level === 2 ? "var(--color-danger-text)" : "var(--color-warn-text)"}
          actions={
            <Link href={"/files" as Route} className={buttonClassName({ variant: "secondary", size: 32 })}>
              Manage files
            </Link>
          }
          onDismiss={() => setQuotaDismissed(quotaKey)}
        >
          {formatSize(used)} of {formatSize(quota)} used ({Math.round(usedPercent(used, quota))}%). {level === 2 ? "New uploads will be blocked." : "Uploads stop at 100%."} Delete files or ask the
          admin for more space.
        </Banner>
      )}
      {!online && (
        <Banner tone="accent" icon="wifi-slash" iconWeight="regular" align="center" title="You're offline" bodyClassName="text-t2">
          Transfers are paused and resume automatically when you&apos;re back online.
        </Banner>
      )}
    </>
  );
}

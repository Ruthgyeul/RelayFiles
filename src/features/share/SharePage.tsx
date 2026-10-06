"use client";

import Link from "next/link";
import type { SharePage as SharePageData } from "@/contracts/share";
import { folderHref } from "@/features/files/paths";
import { useNotice } from "@/shared/hooks/useNotice";
import { Logo } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { NoticePill } from "@/shared/ui/NoticePill";
import { BlockedCard, ExpiredCard, LockedCard, PrivateCard } from "./ShareCards";
import { ShareFolder } from "./ShareFolder";

/** Yellow bar the owner sees while looking at their own link (design "Visitor preview"). */
function PreviewBar({ url, backHref }: { url: string; backHref: ReturnType<typeof folderHref> }) {
  const shown = url.replace(/^https?:\/\//, "");
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-preview-line bg-preview-bg px-4 py-2 text-[13px] text-warn-pale">
      <Icon name="eye" />
      <span className="min-w-0 flex-1 truncate">Visitor preview · {shown}</span>
      <Link href={backHref} className="flex h-7 items-center gap-1.5 rounded-lg border border-preview-btn-line bg-preview-btn px-2.5 text-[12px] font-bold text-warn-pale hover:text-warn-pale">
        <Icon name="arrow-left" />
        Back to app
      </Link>
    </div>
  );
}

/** Public share page `/d/<link>`: one of the design's states, or the open folder. */
export function SharePage({ page }: { page: SharePageData }) {
  const [notice, notify] = useNotice();
  const { owner } = page;
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {owner && <PreviewBar url={page.url} backHref={folderHref(owner.folderId, owner.isRootFolder)} />}
      <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line bg-header px-5">
        <Logo size={28} withText className="text-[18px]" />
      </header>
      <main className="flex flex-1 flex-col">
        {page.status === "blocked" && <BlockedCard />}
        {page.status === "expired" && <ExpiredCard />}
        {page.status === "private" && <PrivateCard ownerNodeId={owner?.nodeId ?? null} notify={notify} />}
        {page.status === "locked" && <LockedCard linkId={page.linkId} name={page.name} />}
        {page.status === "open" && page.view && <ShareFolder linkId={page.linkId} url={page.url} view={page.view} notify={notify} />}
      </main>
      {notice && <NoticePill message={notice} />}
    </div>
  );
}

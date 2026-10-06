"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { filesApi } from "@/features/files/api";
import { folderHref } from "@/features/files/paths";
import { useShell } from "@/features/shell/ShellProvider";
import { useTransfers } from "@/features/transfers/TransfersProvider";
import { Icon } from "@/shared/ui/icon/Icon";

/** "… is ready" card after a Home upload, with the folder's share link. */
export function LastUploadCard() {
  const router = useRouter();
  const { config, notify } = useShell();
  const { lastUpload } = useTransfers();
  const [link, setLink] = useState<{ folderId: string; url: string } | null>(null);

  useEffect(() => {
    if (!lastUpload) return;
    let cancelled = false;
    filesApi
      .getProperties(lastUpload.folderId)
      .then(({ item }) => !cancelled && setLink({ folderId: lastUpload.folderId, url: `${config.publicUrl}/d/${item.linkId}` }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lastUpload, config.publicUrl]);

  if (!lastUpload || link?.folderId !== lastUpload.folderId) return null;
  return (
    <section aria-label="Last upload" className="flex flex-col gap-3 rounded-2xl border border-accent-soft-line bg-card px-5 py-[18px]">
      <div className="flex items-center gap-2.5 font-bold">
        <Icon name="check-circle" weight="fill" size={20} className="text-ok" />
        {lastUpload.name} is ready
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="flex h-10 min-w-[220px] flex-1 items-center overflow-hidden rounded-[10px] border border-ctrl bg-bg px-3 font-mono text-[13px] whitespace-nowrap text-accent-text">{link.url}</div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(link.url).catch(() => undefined);
            notify("Link copied · private, only you can open it");
          }}
          className="flex h-10 items-center gap-1.5 rounded-[10px] border border-accent bg-accent px-4 text-[14px] font-bold text-on-accent"
        >
          <Icon name="copy" />
          Copy
        </button>
        <button
          type="button"
          onClick={() => router.push(folderHref(lastUpload.folderId))}
          className="flex h-10 items-center gap-1.5 rounded-[10px] border border-ctrl bg-btn px-3.5 text-[14px] font-semibold text-t1"
        >
          <Icon name="folder-open" />
          Open folder
        </button>
      </div>
    </section>
  );
}

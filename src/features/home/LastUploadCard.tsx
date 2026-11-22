"use client";

import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/useApiQuery";
import { COPY_FAILED, copyText } from "@/shared/lib/clipboard";
import { filesApi } from "@/shared/lib/files-api";
import { folderHref, shareUrl } from "@/shared/lib/routes";
import { useShell } from "@/features/shell/ShellProvider";
import { useTransfersState } from "@/features/transfers/transfers-context";
import { Icon } from "@/shared/ui/icon/Icon";

/** "… is ready" card after a Home upload, with the folder's share link. */
export function LastUploadCard() {
  const router = useRouter();
  const { config, notify } = useShell();
  const { lastUpload } = useTransfersState();
  const folder = useApiQuery(lastUpload?.folderId ?? null, (folderId) => filesApi.getProperties(folderId));

  if (!lastUpload || folder.status !== "ready") return null;
  const url = shareUrl(config.publicUrl, folder.data.item.linkId);
  return (
    <section aria-label="Last upload" className="flex flex-col gap-3 rounded-2xl border border-accent-soft-line bg-card px-5 py-[18px]">
      <div className="flex items-center gap-2.5 font-bold">
        <Icon name="check-circle" weight="fill" size={20} className="text-ok" />
        {lastUpload.name} is ready
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="flex h-10 min-w-[220px] flex-1 items-center overflow-hidden rounded-[10px] border border-ctrl bg-bg px-3 font-mono text-[13px] whitespace-nowrap text-accent-text">{url}</div>
        <button
          type="button"
          onClick={() => {
            void copyText(url).then((copied) => notify(copied ? "Link copied · private, only you can open it" : COPY_FAILED));
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

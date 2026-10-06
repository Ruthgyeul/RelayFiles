"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import type { ShareItem, ShareView } from "@/contracts/share";
import { formatDateTime, formatSize } from "@/domain/format";
import { itemCount } from "@/domain/tree";
import { kindOf } from "@/features/files/kind";
import { MediaViewer } from "@/features/viewer/MediaViewer";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Tag } from "@/shared/ui/Tag";
import { shareApi, shareUrls } from "./api";
import { ShareRows } from "./ShareItems";

interface ShareFolderProps {
  linkId: string;
  url: string;
  view: ShareView;
  notify: (message: string) => void;
}

/** An open share link (design `shUnlocked`): path, header card, note, items and the viewer. */
export function ShareFolder({ linkId, url, view, notify }: ShareFolderProps) {
  const [viewing, setViewing] = useState<string | null>(null);
  const { folder, root } = view;
  const folderHref = (folderId: string) => (folderId === root.id ? `/d/${linkId}` : `/d/${linkId}?f=${folderId}`) as Route;
  const files = view.items.filter((item) => item.type === "file");
  const fileLink = root.type === "file";
  const headerIcon = fileLink ? kindOf({ type: "file", kind: root.kind }) : null;

  const download = async (target: string) => {
    const problem = await shareApi.download(target);
    if (problem) notify(problem);
  };
  // Folders download as a zip of what visitors can see inside them.
  const downloadItem = (item: ShareItem) => void download(item.type === "folder" ? shareUrls.zip(linkId, item.id) : shareUrls.download(linkId, item.id));
  const downloadAll = () => {
    if (view.folderBusy?.level === 2) return notify("Server busy · try again later");
    void download(fileLink ? shareUrls.download(linkId, root.id) : shareUrls.zip(linkId, folder.id));
  };

  return (
    <div className="mx-auto box-border flex w-full max-w-[880px] flex-col gap-3 px-4 pt-7 pb-[120px]">
      <nav aria-label="Path" className="flex flex-wrap items-center gap-1.5 text-[13px] text-t4">
        {view.crumbs.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1.5">
            {index > 0 && <Icon name="caret-right" />}
            <Link href={folderHref(crumb.id)} className="rounded-md px-1 py-0.5 text-[13px] font-semibold text-t2 hover:bg-card hover:text-t2">
              {crumb.name}
            </Link>
          </span>
        ))}
      </nav>

      <section aria-label={folder.name} className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
        <div className="flex flex-wrap items-start gap-3.5">
          {folder.parentId && (
            <Link href={folderHref(folder.parentId)} aria-label="Parent folder" className="mt-1.5 flex size-9 items-center justify-center rounded-lg text-t3 hover:bg-btn hover:text-t3">
              <Icon name="arrow-left" size={20} />
            </Link>
          )}
          <span className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] border border-ctrl bg-btn">
            {headerIcon ? (
              <Icon name={headerIcon.icon} size={26} style={{ color: headerIcon.color }} />
            ) : (
              <Icon name="folder-open" weight="fill" size={26} className="text-kind-folder" />
            )}
          </span>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <span className="text-[22px] font-bold break-words">{folder.name}</span>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-t4">
              <span className="flex items-center gap-[5px]">
                <Icon name="calendar-blank" />
                <LocalDate value={root.createdAt} format={formatDateTime} />
              </span>
              <span className="flex items-center gap-[5px]">
                <Icon name="copy" />
                {itemCount(view.count)}
              </span>
              <span className="flex items-center gap-[5px]">
                <Icon name="database" />
                {formatSize(Number(view.size))}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {view.tags.map((tag) => (
                <Tag key={tag.label} icon={tag.icon}>
                  {tag.label}
                </Tag>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size={38}
              icon="link-simple"
              onClick={() => {
                navigator.clipboard?.writeText(url).catch(() => undefined);
                notify("Link copied");
              }}
            >
              Copy link
            </Button>
            {view.downloadsAllowed && (
              <Button variant="primary" size={38} icon="download-simple" hoverable onClick={downloadAll}>
                Download all
              </Button>
            )}
          </div>
        </div>
        {view.note && (
          <div className="flex gap-2 rounded-[10px] bg-sunk px-3.5 py-3 text-[14px] leading-[1.5] text-t2">
            <Icon name="note" className="mt-[3px] shrink-0 text-t4" />
            {view.note}
          </div>
        )}
      </section>

      <ShareRows items={view.items} folderHref={folderHref} onOpen={(item) => setViewing(item.id)} onDownload={downloadItem} />
      <span className="pt-2 text-center text-[12px] text-t5">Shared privately with RelayFiles</span>

      <MediaViewer
        items={files.map((item) => ({ id: item.id, name: item.name, kind: item.kind ?? "other", src: shareUrls.stream(linkId, item.id) }))}
        currentId={viewing}
        onSelect={setViewing}
        onClose={() => setViewing(null)}
        onDownload={
          view.downloadsAllowed
            ? (id) => {
                const item = files.find((entry) => entry.id === id);
                if (item?.canDownload) downloadItem(item);
                else notify("Download limit reached");
              }
            : undefined
        }
        notify={notify}
      />
    </div>
  );
}

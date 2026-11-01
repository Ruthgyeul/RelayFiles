"use client";

import { useEffect, useState } from "react";
import type { LinkEventDto } from "@/contracts/nodes";
import { formatAgo } from "@/domain/format";
import { useNow } from "@/shared/hooks/useNow";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";
import { IconButton } from "@/shared/ui/IconButton";
import { fileUrls, filesApi } from "@/shared/lib/files-api";
import { EVENT_LOOK } from "./activity-look";
import { ActivitySummary } from "./ActivitySummary";

export interface ActivityRequest {
  id: string;
  name: string;
  url: string;
}

/** "Link activity · …" (520px): a summary, the CSV export and the newest 200 events through the share link. */
export function ActivityDialog({ request, onClose }: { request: ActivityRequest | null; onClose: () => void }) {
  const [events, setEvents] = useState<{ id: string; list: LinkEventDto[] } | null>(null);
  const now = useNow(request !== null, 60_000);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    filesApi
      .activity(request.id)
      .then((list) => !cancelled && setEvents({ id: request.id, list }))
      .catch(() => !cancelled && setEvents({ id: request.id, list: [] }));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const list = events && request && events.id === request.id ? events.list : [];

  return (
    <Modal open={request !== null} onClose={onClose} width={520} layer="dialog" label={`Link activity · ${request?.name ?? ""}`} className="overflow-hidden">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-card-line px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[16px] font-bold">Link activity · {request?.name}</span>
          <span className="truncate font-mono text-[12px] text-t4">{request?.url}</span>
        </div>
        <IconButton icon="x" label="Close" size={32} iconSize={18} onClick={onClose} />
      </div>
      {request && <ActivitySummary events={list} now={now} csvUrl={fileUrls.activityCsv(request.id)} />}
      <div className="min-h-0 flex-1 overflow-auto px-5 pt-1.5 pb-3.5">
        {list.length === 0 ? (
          <div className="px-2 py-8 text-center text-[14px] text-pretty text-t4">No visits yet. Opens, plays and downloads through this link will show up here.</div>
        ) : (
          list.map((event, index) => {
            const look = EVENT_LOOK[event.kind];
            return (
              <div key={`${event.at}-${index}`} className="flex items-center gap-3 border-b border-card-line py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-btn">
                  <Icon name={look.icon} style={{ color: look.color }} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 gap-1.5 text-[14px] font-bold">
                    {look.label}
                    {event.kind !== "open" && event.kind !== "reset" && <span className="truncate font-medium text-t2">{event.fileName}</span>}
                  </span>
                  <span className="text-[12px] text-t4">{event.kind === "reset" ? "Previous link disabled" : `${event.device} · ${event.ipMasked} · ${event.country}`}</span>
                </div>
                <span className="shrink-0 text-[12px] text-t4">{formatAgo(Date.parse(event.at), now)}</span>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

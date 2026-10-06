"use client";

import { useState } from "react";
import { ANNOUNCEMENT_LEVELS, MAX_ANNOUNCEMENT_LENGTH, type AnnouncementDto, type AnnouncementLevel } from "@/contracts/server-settings";
import { formatDateTime } from "@/domain/format";
import { ANNOUNCEMENT_LOOK } from "@/features/shell/AnnouncementBanner";
import { useMounted } from "@/shared/hooks/useMounted";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";

interface AnnouncementCardProps {
  announcement: AnnouncementDto | null;
  busy: boolean;
  onPublish: (text: string, level: AnnouncementLevel) => void;
  onTakeDown: () => void;
  notify: (message: string) => void;
}

/** Announcement editor (design Server page): text, level, Publish and Take down. */
export function AnnouncementCard({ announcement, busy, onPublish, onTakeDown, notify }: AnnouncementCardProps) {
  const [text, setText] = useState(announcement?.text ?? "");
  const [level, setLevel] = useState<AnnouncementLevel>(announcement?.level ?? "info");
  const mounted = useMounted();
  const live = announcement?.live === true;
  return (
    <section aria-label="Announcement" className="flex flex-col gap-3.5 rounded-2xl border border-card-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon name="megaphone" size={20} className="text-accent-icon" />
        </span>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[17px] font-bold">Announcement</h2>
          <span className="text-[12px] text-t4">Shown at the top of every account until dismissed.</span>
        </div>
        <span className={cn("flex items-center gap-1.5 text-[12px] font-bold", live ? "text-ok-text" : "text-t4")}>
          <span className={cn("size-2 rounded-full", live ? "bg-ok-text" : "bg-t4")} />
          {live && announcement ? `Live since ${mounted ? formatDateTime(announcement.at).replace(/, \d{4}/, "") : ""}` : "Not showing"}
        </span>
      </div>
      <textarea
        value={text}
        rows={3}
        maxLength={MAX_ANNOUNCEMENT_LENGTH}
        aria-label="Announcement text"
        placeholder="e.g. Server maintenance on Oct 12, 02:00–03:00. Streaming will be unavailable."
        onChange={(event) => setText(event.target.value)}
        className="resize-y rounded-[10px] border border-ctrl bg-bg px-3 py-2.5 text-[14px] leading-[1.5] text-t1 outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        {ANNOUNCEMENT_LEVELS.map((key) => {
          const look = ANNOUNCEMENT_LOOK[key];
          const on = level === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setLevel(key)}
              className={cn("flex h-[34px] items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-bold", on ? cn(look.box, look.text, "border-current") : "border-ctrl bg-btn text-t2")}
            >
              <Icon name={look.icon} />
              {look.label}
            </button>
          );
        })}
        <span className="flex-1" />
        {live && (
          <Button variant="danger-outline" size={34} disabled={busy} onClick={onTakeDown} className="px-3">
            Take down
          </Button>
        )}
        <Button
          variant="primary"
          size={34}
          icon="paper-plane-tilt"
          disabled={busy}
          onClick={() => (text.trim() ? onPublish(text.trim(), level) : notify("Write a message first"))}
          className="px-3.5"
        >
          Publish
        </Button>
      </div>
    </section>
  );
}

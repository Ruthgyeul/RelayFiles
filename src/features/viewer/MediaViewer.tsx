"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatClock } from "@/domain/format";
import { useMounted } from "@/shared/hooks/useMounted";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";
import { resumeStore } from "./resume";

export interface ViewerItem {
  id: string;
  name: string;
  kind: "video" | "audio" | "image" | "other";
  /** URL of the media for inline playback. */
  src: string;
}

interface MediaViewerProps {
  items: ViewerItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Hidden when the share link is stream-only. */
  onDownload?: (id: string) => void;
  notify: (message: string) => void;
}

const SEEK = { short: 5, long: 10 } as const;
const VOLUME_STEP = 0.1;
const PERCENT = 100;

function ViewerButton({ icon, label, onClick, large }: { icon: IconName; label: string; onClick: () => void; large: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("flex shrink-0 items-center justify-center border-0 bg-transparent text-t2", large ? "size-9 rounded-lg hover:bg-viewer-hover" : "size-11")}
    >
      <Icon name={icon} size={large ? 18 : 20} />
    </button>
  );
}

/** Image, video, audio or a "no preview" card, with resume for audio and video. */
function Stage({ item, large, onDownload, notify }: { item: ViewerItem; large: boolean; onDownload?: () => void; notify: (message: string) => void }) {
  const mediaProps = {
    src: item.src,
    controls: true,
    autoPlay: true,
    "data-viewer-media": true,
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => resumeStore.track(item.id, event.currentTarget),
    onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => resumeStore.track(item.id, event.currentTarget),
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const at = resumeStore.restore(item.id, event.currentTarget);
      if (at !== null) notify(`Resumed from ${formatClock(at)}`);
    },
  };
  switch (item.kind) {
    case "video":
      return <video key={item.id} {...mediaProps} playsInline className="size-full bg-black object-contain" />;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element -- user media is served by the app with auth cookies, not optimizable by next/image
      return <img key={item.id} src={item.src} alt={item.name} className="max-h-full max-w-full object-contain" />;
    case "audio":
      return (
        <div className={cn("flex flex-col items-center gap-5", large ? "w-[min(420px,90%)]" : "w-[90%]")}>
          <span className={cn("flex items-center justify-center rounded-2xl bg-card", large ? "size-40" : "size-[180px]")}>
            <Icon name="music-notes" size={large ? 56 : 64} className="text-kind-audio" />
          </span>
          <audio key={item.id} {...mediaProps} className="w-full" />
        </div>
      );
    default:
      return (
        <div className="flex flex-col items-center gap-3 text-t4">
          <Icon name="file-zip" size={56} />
          No preview for this file type
          {large && onDownload && (
            <button type="button" onClick={onDownload} className="h-9 rounded-[10px] border-0 bg-accent px-4 text-[14px] font-bold text-on-accent">
              Download
            </button>
          )}
        </div>
      );
  }
}

/**
 * Media viewer from the design: an 880px modal on wider screens, full screen below 720px.
 * Keys: Space/K play, ←/→ 5 s (or previous/next file for images), J/L 10 s, ↑/↓ volume,
 * M mute, F fullscreen, N/P next/previous, Esc close.
 */
export function MediaViewer({ items, currentId, onSelect, onClose, onDownload, notify }: MediaViewerProps) {
  const { small } = useViewport();
  const mounted = useMounted();
  const index = items.findIndex((item) => item.id === currentId);
  const item = index >= 0 ? items[index]! : null;
  const latest = useRef({ items, index, onSelect, notify, onClose, small });
  useEffect(() => {
    latest.current = { items, index, onSelect, notify, onClose, small };
  });

  useEffect(() => {
    if (!item) return;
    const step = (delta: number) => {
      const { items: list, index: at, onSelect: select } = latest.current;
      if (list.length > 0) select(list[(at + delta + list.length) % list.length]!.id);
    };
    const onKey = (event: KeyboardEvent) => {
      const media = document.querySelector<HTMLMediaElement>("[data-viewer-media]");
      const key = event.key.toLowerCase();
      // The modal closes itself on Escape; the full-screen mobile viewer is not a Modal.
      if (event.key === "Escape" && latest.current.small) latest.current.onClose();
      else if (media && (key === " " || key === "k")) {
        event.preventDefault();
        if (media.paused) void media.play();
        else media.pause();
      } else if (media && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        media.currentTime = Math.max(0, media.currentTime + (event.key === "ArrowRight" ? SEEK.short : -SEEK.short));
      } else if (media && (key === "j" || key === "l")) {
        media.currentTime = Math.max(0, media.currentTime + (key === "l" ? SEEK.long : -SEEK.long));
      } else if (media && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        media.volume = Math.min(1, Math.max(0, media.volume + (event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP)));
        latest.current.notify(`Volume ${Math.round(media.volume * PERCENT)}%`);
      } else if (media && key === "m") {
        media.muted = !media.muted;
        latest.current.notify(media.muted ? "Muted" : "Sound on");
      } else if (media && key === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void media.requestFullscreen?.();
      } else if (event.key === "ArrowRight" || key === "n") step(1);
      else if (event.key === "ArrowLeft" || key === "p") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [item]);

  if (!item || !mounted) return null;
  const position = `${index + 1} / ${items.length}`;
  const download = onDownload ? () => onDownload(item.id) : undefined;
  const buttons = (large: boolean): ReactNode => (
    <>
      <ViewerButton icon="caret-left" label="Previous file" large={large} onClick={() => onSelect(items[(index - 1 + items.length) % items.length]!.id)} />
      <ViewerButton icon="caret-right" label="Next file" large={large} onClick={() => onSelect(items[(index + 1) % items.length]!.id)} />
      {download && <ViewerButton icon="download-simple" label="Download" large={large} onClick={download} />}
      <ViewerButton icon="x" label="Close viewer" large={large} onClick={onClose} />
    </>
  );

  if (small) {
    return createPortal(
      <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-(--z-viewer-backdrop) flex flex-col bg-black pb-[env(safe-area-inset-bottom)]">
        <div className="flex h-[52px] shrink-0 items-center gap-0.5 border-b border-viewer-line pr-1 pl-3">
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{item.name}</span>
          {buttons(false)}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Stage item={item} large={false} notify={notify} />
        </div>
        <div className="flex h-10 shrink-0 items-center justify-center text-[12px] text-t4">{position}</div>
      </div>,
      document.body,
    );
  }

  return (
    <Modal open onClose={onClose} width={880} gutter={48} layer="viewer" backdrop="viewer" label={item.name} className="overflow-hidden rounded-[14px] border-0 bg-black shadow-viewer">
      <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-viewer-line pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{item.name}</span>
        <span className="px-2 text-[12px] text-t4">{position}</span>
        {buttons(true)}
      </div>
      <div className="flex h-[min(70vh,520px)] items-center justify-center bg-black">
        <Stage item={item} large onDownload={download} notify={notify} />
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { documentPreviewOf } from "@/domain/file-format";
import { formatClock } from "@/domain/format";
import { useMounted } from "@/shared/hooks/useMounted";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";
import { DocumentStage } from "./DocumentStage";
import { playbackProps } from "./playback";
import { prefetchImage } from "./prefetch";
import { resumeStore } from "./resume";
import { StageImage, StageVideo, type MediaHandlers } from "./StageMedia";
import type { SubtitleSource } from "./subtitle-tracks";
import { useSlideshow } from "./useSlideshow";
import { useViewerKeys } from "./useViewerKeys";

export interface ViewerItem {
  id: string;
  name: string;
  kind: "video" | "audio" | "image" | "other";
  /** URL of the media for inline playback. */
  src: string;
  /** Worker thumbnail, shown at once while the picture or video loads. */
  thumbSrc?: string | null;
  /** Screen-sized picture of an image (the server sends the original when there is none). */
  previewSrc?: string;
  /** The video converted while it plays, for containers the browser cannot decode. */
  transcodeSrc?: string;
  /** Subtitle files beside a video (see `withSubtitles`). */
  subtitles?: SubtitleSource[];
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

function ViewerButton({ icon, label, onClick, large, pressed }: { icon: IconName; label: string; onClick: () => void; large: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("flex shrink-0 items-center justify-center border-0 bg-transparent text-t2", large ? "size-9 rounded-lg hover:bg-viewer-hover" : "size-11")}
    >
      <Icon name={icon} size={large ? 18 : 20} />
    </button>
  );
}

/** Image, video, audio or a document (text, code, PDF, ...), with resume for audio and video. */
function Stage({ item, large, slideshow, onDownload, notify }: { item: ViewerItem; large: boolean; slideshow: boolean; onDownload?: () => void; notify: (message: string) => void }) {
  const handlers: MediaHandlers = {
    "data-viewer-media": true,
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => resumeStore.track(item.id, event.currentTarget),
    onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => resumeStore.track(item.id, event.currentTarget),
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const at = resumeStore.restore(item.id, event.currentTarget);
      if (at !== null) notify(`Resumed from ${formatClock(at)}`);
    },
  };
  const thumbSrc = item.thumbSrc ?? null;
  const docFormat = documentPreviewOf(item.name, item.kind);
  if (docFormat) return <DocumentStage key={item.id} name={item.name} src={item.src} format={docFormat} onDownload={large ? onDownload : undefined} notify={notify} />;
  switch (item.kind) {
    case "video":
      return <StageVideo key={item.id} name={item.name} src={item.src} thumbSrc={thumbSrc} transcodeSrc={item.transcodeSrc} subtitles={item.subtitles} handlers={handlers} />;
    case "image":
      return <StageImage key={item.id} name={item.name} src={item.previewSrc ?? item.src} thumbSrc={thumbSrc} fade={slideshow} />;
    case "audio":
      return (
        <div className={cn("flex flex-col items-center gap-5", large ? "w-[min(420px,90%)]" : "w-[90%]")}>
          <span className={cn("flex items-center justify-center rounded-2xl bg-card", large ? "size-40" : "size-[180px]")}>
            <Icon name="music-notes" size={large ? 56 : 64} className="text-kind-audio" />
          </span>
          <audio key={item.id} {...handlers} {...playbackProps} src={item.src} controls autoPlay className="w-full" />
        </div>
      );
    default:
      return null;
  }
}

/**
 * Media viewer from the design: an 880px modal on wider screens, full screen below 720px.
 * Keys (see `useViewerKeys`): Space/K play or slideshow, arrows, J/L, M, F, N/P, Esc. Pictures
 * play as a slideshow from the play button or Space; stepping or closing stops it.
 */
export function MediaViewer({ items, currentId, onSelect, onClose, onDownload, notify }: MediaViewerProps) {
  const { small } = useViewport();
  const mounted = useMounted();
  const index = items.findIndex((item) => item.id === currentId);
  const item = index >= 0 ? items[index]! : null;
  const slideshow = useSlideshow(items, index, onSelect, notify);
  /** The user's own step to another file (a slideshow stops). */
  const step = (delta: number) => {
    slideshow.stop();
    if (items.length > 0) onSelect(items[(index + delta + items.length) % items.length]!.id);
  };
  const close = () => {
    slideshow.stop();
    onClose();
  };
  useViewerKeys(item !== null, { step, close, small, notify, slideshow });

  // The previous and next pictures load in the background, so stepping shows them at once.
  useEffect(() => {
    if (index < 0 || items.length < 2) return;
    for (const delta of [1, -1]) {
      const neighbor = items[(index + delta + items.length) % items.length]!;
      if (neighbor.kind === "image") prefetchImage(neighbor.previewSrc ?? neighbor.src);
    }
  }, [index, items]);

  if (!item || !mounted) return null;
  const position = `${index + 1} / ${items.length}`;
  const download = onDownload ? () => onDownload(item.id) : undefined;
  const buttons = (large: boolean): ReactNode => (
    <>
      {slideshow.available && (
        <ViewerButton
          icon={slideshow.playing ? "pause" : "play"}
          label={slideshow.playing ? "Pause slideshow" : "Play slideshow"}
          pressed={slideshow.playing}
          large={large}
          onClick={slideshow.toggle}
        />
      )}
      <ViewerButton icon="caret-left" label="Previous file" large={large} onClick={() => step(-1)} />
      <ViewerButton icon="caret-right" label="Next file" large={large} onClick={() => step(1)} />
      {download && <ViewerButton icon="download-simple" label="Download" large={large} onClick={download} />}
      <ViewerButton icon="x" label="Close viewer" large={large} onClick={close} />
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
          <Stage item={item} large={false} slideshow={slideshow.playing} notify={notify} />
        </div>
        <div className="flex h-10 shrink-0 items-center justify-center text-[12px] text-t4">{position}</div>
      </div>,
      document.body,
    );
  }

  return (
    <Modal open onClose={close} width={880} gutter={48} layer="viewer" backdrop="viewer" label={item.name} className="overflow-hidden rounded-[14px] border-0 bg-black shadow-viewer">
      <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-viewer-line pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{item.name}</span>
        <span className="px-2 text-[12px] text-t4">{position}</span>
        {buttons(true)}
      </div>
      <div className="flex h-[min(70vh,520px)] items-center justify-center bg-black">
        <Stage item={item} large slideshow={slideshow.playing} onDownload={download} notify={notify} />
      </div>
    </Modal>
  );
}

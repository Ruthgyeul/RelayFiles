"use client";

import type { PreviewKind } from "@/domain/media";
import { cn } from "@/shared/lib/cn";
import { InlineAudio } from "./InlineAudio";
import { MediaPreview } from "./MediaPreview";

interface ListPreviewProps {
  id: string;
  name: string;
  kind: PreviewKind;
  src: string;
  thumbSrc: string | null;
  loadOriginal: boolean;
  onOpen: () => void;
  /** Left padding that lines the preview up with the name (differs per list). */
  className?: string;
}

/**
 * The preview under a file name in a list: a square picture (full width on phones, 288px
 * above 720px) for images and videos, or an audio player.
 */
export function ListPreview({ id, name, kind, src, thumbSrc, loadOriginal, onOpen, className }: ListPreviewProps) {
  if (kind === "audio") {
    return (
      <div data-preview="audio" className={className}>
        <InlineAudio id={id} name={name} src={src} />
      </div>
    );
  }
  return (
    <div data-preview={kind} className={className}>
      <div
        onClick={onOpen}
        className={cn(
          "relative flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-card-line bg-black",
          "sm:w-[min(288px,100%)]",
        )}
      >
        <MediaPreview id={id} name={name} kind={kind} src={src} thumbSrc={thumbSrc} variant="row" loadOriginal={loadOriginal} onOpen={onOpen} />
      </div>
    </div>
  );
}

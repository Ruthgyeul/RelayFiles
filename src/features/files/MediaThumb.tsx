"use client";

import type { NodeItem } from "@/contracts/nodes";
import { MediaPreview } from "@/features/viewer/MediaPreview";
import { fileUrls } from "./api";

export { ResumeBar } from "@/features/viewer/MediaPreview";

/** Grid card picture of the owner's image or video (worker thumbnail, else the file itself). */
export function MediaThumb({ item, onOpen }: { item: NodeItem; onOpen: () => void }) {
  if (item.kind !== "image" && item.kind !== "video") return null;
  return (
    <MediaPreview
      id={item.id}
      name={item.name}
      kind={item.kind}
      src={fileUrls.stream(item.id)}
      thumbSrc={item.hasThumb ? fileUrls.thumb(item.id) : null}
      variant="card"
      loadOriginal
      onOpen={onOpen}
    />
  );
}

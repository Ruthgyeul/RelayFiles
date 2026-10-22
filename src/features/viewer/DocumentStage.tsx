"use client";

import { lazy, Suspense } from "react";
import type { FileFormat } from "@/domain/file-format";
import { FORMAT_ICON } from "@/features/files/kind";
import { FontView } from "./FontView";
import { LoadingPreview, PreviewMessage } from "./PreviewMessage";
import { SvgView } from "./SvgView";
import { TextDocument } from "./TextDocument";

const PdfView = lazy(() => import("./PdfView"));

interface DocumentStageProps {
  name: string;
  src: string;
  format: FileFormat;
  onDownload?: () => void;
  notify: (message: string) => void;
}

/** The "no preview" card, with the file's own icon and a download button when allowed. */
function NoPreview({ format, reason, onDownload }: { format: FileFormat; reason: string; onDownload?: () => void }) {
  const icon = FORMAT_ICON[format.icon];
  return (
    <PreviewMessage
      icon={icon.icon}
      iconColor={icon.color}
      action={
        onDownload && (
          <button type="button" onClick={onDownload} className="h-9 rounded-[10px] border-0 bg-accent px-4 text-[14px] font-bold text-on-accent">
            Download
          </button>
        )
      }
    >
      {reason}
    </PreviewMessage>
  );
}

/** A file that is not media: text, code, Markdown, a table, a PDF, an SVG or a font. */
export function DocumentStage({ name, src, format, onDownload, notify }: DocumentStageProps) {
  const noPreview = <NoPreview format={format} reason="No preview for this file type" onDownload={onDownload} />;
  const tooLarge = <NoPreview format={format} reason="Too large to preview" onDownload={onDownload} />;
  switch (format.preview) {
    case "text":
    case "code":
    case "markdown":
    case "table":
      return <TextDocument src={src} format={format} binary={noPreview} notify={notify} />;
    case "pdf":
      return (
        <Suspense fallback={<LoadingPreview />}>
          <PdfView src={src} />
        </Suspense>
      );
    case "svg":
      return <SvgView src={src} name={name} tooLarge={tooLarge} />;
    case "font":
      return <FontView src={src} tooLarge={tooLarge} />;
    case null:
      return noPreview;
  }
}

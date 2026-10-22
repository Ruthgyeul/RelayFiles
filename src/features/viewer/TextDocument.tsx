"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import { lineCount, prettyJson } from "@/domain/document";
import type { FileFormat } from "@/domain/file-format";
import { formatSize } from "@/domain/format";
import { CodeView } from "./CodeView";
import { DocumentBar } from "./DocumentBar";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { TableView } from "./TableView";
import { useFileText } from "./useFileText";

const MarkdownView = lazy(() => import("./MarkdownView"));

const toolButton = "h-7 shrink-0 rounded-md border border-viewer-line bg-transparent px-2.5 text-[12px] font-bold text-t4 aria-pressed:bg-viewer-hover aria-pressed:text-t1";

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={toolButton}>
      {label}
    </button>
  );
}

interface TextDocumentProps {
  src: string;
  format: FileFormat;
  /** Shown instead of the text when the file turns out to be binary. */
  binary: ReactNode;
  notify: (message: string) => void;
}

/**
 * Text, code, Markdown or a CSV/TSV table from the start of the file, with a bar for the
 * format, line count, how much is shown, and view toggles (rendered/source, wrap, copy).
 */
export function TextDocument({ src, format, binary, notify }: TextDocumentProps) {
  const file = useFileText(src, format.sniff === true);
  const rendered = format.preview === "markdown" || format.preview === "table";
  const [source, setSource] = useState(false);
  const [wrap, setWrap] = useState(format.preview !== "code");

  if (file.status === "loading") return <LoadingPreview />;
  if (file.status === "error") return <FailedPreview />;
  if (file.status === "binary") return binary;

  const text = format.language === "json" && !file.truncated ? (prettyJson(file.text) ?? file.text) : file.text;
  const showRendered = rendered && !source;
  const lines = lineCount(text);
  const details = [
    format.label,
    `${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"}`,
    file.encoding === "utf-8" ? null : file.encoding.toUpperCase(),
    file.truncated ? `First ${formatSize(file.shown)}${file.total ? ` of ${formatSize(file.total)}` : ""}` : null,
  ].filter((detail) => detail !== null);

  let body: ReactNode;
  if (showRendered && format.preview === "markdown") {
    body = (
      <Suspense fallback={<LoadingPreview />}>
        <MarkdownView text={text} />
      </Suspense>
    );
  } else if (showRendered) {
    body = <TableView text={text} delimiter={format.delimiter ?? ","} />;
  } else {
    body = <CodeView text={text} language={format.preview === "markdown" ? "markdown" : format.language} wrap={wrap} />;
  }

  return (
    <div className="flex size-full min-h-0 flex-col self-stretch">
      <DocumentBar details={details}>
        {rendered && <Toggle label="Source" on={source} onChange={setSource} />}
        {!showRendered && <Toggle label="Wrap" on={wrap} onChange={setWrap} />}
        <button
          type="button"
          className={toolButton}
          onClick={() => {
            navigator.clipboard?.writeText(file.text).then(
              () => notify("Copied"),
              () => notify("Copy failed"),
            );
          }}
        >
          Copy
        </button>
      </DocumentBar>
      <div tabIndex={0} aria-label="File contents" className="min-h-0 flex-1 overflow-auto bg-black">
        {body}
      </div>
    </div>
  );
}

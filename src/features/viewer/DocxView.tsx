"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatSize } from "@/domain/format";
import { DocumentBar } from "./DocumentBar";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { useFileBytes } from "./useFileBytes";

/**
 * Word HTML made safe to insert: DOMPurify drops scripts, event handlers and dangerous URLs
 * (pictures stay as embedded data URLs, so nothing is fetched); links open in a new tab.
 */
async function safeHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  // A template's content is inert: nothing in it loads or runs while the links are adjusted.
  const body = document.createElement("template");
  body.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input"] });
  for (const link of body.content.querySelectorAll("a[href]")) {
    if (link.getAttribute("href")?.startsWith("#")) continue;
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  return body.innerHTML;
}

/** Word's title styles, which mammoth leaves as plain paragraphs by default. */
const STYLE_MAP = ["p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => h2.subtitle:fresh"];

/**
 * A Word document (.docx) converted to HTML in the browser with mammoth: headings, lists,
 * tables, links and pictures, without the page layout (fonts, columns, headers and footers).
 */
export default function DocxView({ src, tooLarge }: { src: string; tooLarge: ReactNode }) {
  const file = useFileBytes(src);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; html: string }>({ status: "loading" });
  useEffect(() => {
    if (file.status !== "ready") return;
    let live = true;
    import("mammoth")
      .then((module) => (module.default ?? module).convertToHtml({ arrayBuffer: file.bytes.buffer }, { styleMap: STYLE_MAP, externalFileAccess: false }))
      .then((result) => safeHtml(result.value))
      .then((html) => {
        if (live) setState({ status: "ready", html });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [file]);

  if (file.status === "error" || state.status === "error") return <FailedPreview />;
  if (file.status === "too-large") return tooLarge;
  if (file.status === "loading" || state.status === "loading") return <LoadingPreview />;
  return (
    <div className="flex size-full min-h-0 flex-col self-stretch">
      <DocumentBar details={["Word document", formatSize(file.bytes.length), "Text and layout only"]} />
      <div tabIndex={0} aria-label="File contents" className="min-h-0 flex-1 overflow-auto bg-black">
        {/* Sanitized above; the HTML comes from the document's own text, never from a server. */}
        <article className="markdown-body mx-auto max-w-[760px] px-5 py-4 text-[14px] leading-[1.65] text-t2" dangerouslySetInnerHTML={{ __html: state.html }} />
      </div>
    </div>
  );
}

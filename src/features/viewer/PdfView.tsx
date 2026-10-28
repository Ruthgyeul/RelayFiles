"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { formatCount } from "@/domain/format";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { DocumentBar } from "./DocumentBar";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { loadPdfJs } from "./pdfjs";

const PAGE_GAP_PX = 12;
const STAGE_PADDING_PX = 12;

/** Width of the scroll area's content box, kept up to date. */
function useContentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * One page: a placeholder of the page's size, drawn while it is near the visible area and
 * cleared again when it scrolls far away, so long documents hold only a few canvases.
 */
function PdfPage({ doc, number, width, aspect, root }: { doc: PDFDocumentProxy; number: number; width: number; aspect: number; root: RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [pageAspect, setPageAspect] = useState(aspect);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), {
      root: root.current,
      rootMargin: `${DOCUMENT_PREVIEW.pdfPreloadMarginPx}px 0px`,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const element = canvas.current;
    if (!near || !element) return;
    let live = true;
    let task: RenderTask | null = null;
    doc
      .getPage(number)
      .then((page) => {
        if (!live) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, DOCUMENT_PREVIEW.pdfMaxPixelRatio);
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        element.width = Math.floor(viewport.width);
        element.height = Math.floor(viewport.height);
        setPageAspect(base.height / base.width);
        task = page.render({ canvas: element, viewport });
        return task.promise;
      })
      .catch(() => undefined);
    return () => {
      live = false;
      task?.cancel();
      // Free the bitmap of a page that is no longer near the screen.
      element.width = 0;
      element.height = 0;
    };
  }, [near, doc, number, width]);

  return <canvas ref={canvas} aria-label={`Page ${number}`} className="block shrink-0 bg-white" style={{ width, height: Math.round(width * pageAspect) }} />;
}

/** A PDF drawn page by page with pdf.js (works on phones, which have no built-in PDF viewer in pages). */
export default function PdfView({ src }: { src: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const contentWidth = useContentWidth(scroller);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; doc: PDFDocumentProxy; aspect: number }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | null = null;
    loadPdfJs()
      .then(async (pdfjs) => {
        // Range requests: only the parts of the file needed for the pages on screen are fetched.
        task = pdfjs.getDocument({ url: src, disableAutoFetch: true, enableXfa: false });
        const doc = await task.promise;
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (live) setState({ status: "ready", doc, aspect: first.height / first.width });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [src]);

  const width = Math.max(0, (contentWidth || DOCUMENT_PREVIEW.pdfFallbackWidthPx) - 2 * STAGE_PADDING_PX);
  const pages = state.status === "ready" ? state.doc.numPages : null;
  return (
    <div className="flex size-full min-h-0 flex-col self-stretch">
      {pages !== null && <DocumentBar details={["PDF", `${formatCount(pages)} ${pages === 1 ? "page" : "pages"}`]} />}
      <div ref={scroller} tabIndex={0} aria-label="PDF pages" className="min-h-0 flex-1 overflow-auto bg-viewer-hover">
        {state.status === "loading" && <LoadingPreview />}
        {state.status === "error" && <FailedPreview />}
        {state.status === "ready" && (
          <div className="flex flex-col items-center" style={{ gap: PAGE_GAP_PX, padding: STAGE_PADDING_PX }}>
            {Array.from({ length: state.doc.numPages }, (_, index) => (
              <PdfPage key={index} doc={state.doc} number={index + 1} width={width} aspect={state.aspect} root={scroller} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

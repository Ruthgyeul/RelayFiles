// The legacy build carries polyfills for the newest JavaScript the modern build relies on
// (Map.getOrInsertComputed, ...), so PDFs also open in browsers a few versions old.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfJs> | null = null;

/** pdf.js and its worker, loaded the first time a PDF is opened (kept out of the page bundle). */
export function loadPdfJs(): Promise<PdfJs> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    return pdfjs;
  });
  return loading;
}

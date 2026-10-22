// pdf.js parses and decodes PDFs in this worker, off the page's main thread. Bundled from a
// local file so `new Worker(new URL(...))` resolves it with the app's own chunks.
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

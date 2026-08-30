/**
 * Renders up to the first 3 pages of a PDF to PNGs — used only when the
 * admin uploads a note, so the shop can show a multi-page preview without
 * ever handling a real PDF itself (see docs and CLAUDE.md's Stack section
 * for why: PDF.js only loads in this admin bundle, never the customer-facing
 * one).
 */
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export preview image"))), "image/png");
  });
}

/**
 * @param {File} file A PDF file.
 * @param {number} maxPages Preview at most this many pages (fewer if the PDF is shorter).
 * @returns {Promise<Blob[]>} One PNG per rendered page, in order.
 */
export async function renderPreviewPages(file, maxPages = 3) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);

  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.6 }); // wide enough to stay legible in the preview modal
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    pages.push(await canvasToPng(canvas));
  }
  return pages;
}

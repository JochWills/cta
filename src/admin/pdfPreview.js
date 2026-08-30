/**
 * Renders a PDF's first page to a PNG — used only when the admin uploads a
 * note, so the shop can show a preview without ever handling a real PDF
 * itself (see docs and CLAUDE.md's Stack section for why: PDF.js only
 * loads in this admin bundle, never in the customer-facing one).
 */
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

/** @param {File} file A PDF file. @returns {Promise<Blob>} PNG of page 1. */
export async function renderFirstPageToPng(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 1.6 }); // wide enough to stay legible in the preview modal
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export preview image"))), "image/png");
  });
}

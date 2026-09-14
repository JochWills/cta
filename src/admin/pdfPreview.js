/**
 * Renders up to the first 3 pages of a PDF to PNGs — used only when the
 * admin uploads a note, so the shop can show a multi-page preview without
 * ever handling a real PDF itself (see docs and CLAUDE.md's Stack section
 * for why: PDF.js only loads in this admin bundle, never the customer-facing
 * one).
 */
import "./mapUpsertPolyfill.js"; // must run before pdfjsLib touches a single Map — see that file's comment
import * as pdfjsLib from "pdfjs-dist";
import { fixSymbolicFontEncoding } from "./fixSymbolicFontEncoding.js";

// Constructing the worker ourselves (via Vite's own `new Worker(new URL(...))`
// handling) rather than just pointing GlobalWorkerOptions.workerSrc at
// pdfjs-dist's bundle directly, so pdfjsWorkerEntry.js's own polyfill import
// gets a chance to run inside the worker before the real worker code does —
// see that file's comment for why that's necessary too, not just here.
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
  new URL("./pdfjsWorkerEntry.js", import.meta.url),
  { type: "module" }
);

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
  const rawData = new Uint8Array(await file.arrayBuffer());
  // Some PDF producers embed a Symbolic TrueType font with no /Encoding,
  // relying on the font's own internal cmap — valid per spec, but a real
  // pdf.js bug misreads it and silently swaps some letters for the wrong
  // glyph (T, D, x, q and others, consistently, regardless of browser — see
  // fixSymbolicFontEncoding.js for the full diagnosis and fix). Cheap no-op
  // for any PDF that isn't built this way.
  const data = await fixSymbolicFontEncoding(rawData);
  // disableFontFace: makes pdf.js draw every glyph itself from the font's
  // own outline data as vector paths instead of via the browser's native
  // @font-face/text-shaping — deterministic across engines, and harmless
  // here since this only ever runs offscreen, once, to export a PNG.
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
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

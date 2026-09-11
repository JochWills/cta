/**
 * The actual worker script pdfPreview.js spins up, instead of pointing
 * GlobalWorkerOptions.workerSrc straight at pdfjs-dist's own pre-built
 * pdf.worker.min.mjs. That direct-URL approach (still fine for a file with
 * no further imports of its own, which is why it's still how this loads
 * the mjs at all) can't run anything *before* the real worker code — and
 * the polyfill below has to run first, inside this worker's own global
 * scope, or every getOrInsertComputed call in the parsing/rendering code
 * that follows throws in Safari. Going through our own entry file like
 * this (built via Vite's `new Worker(new URL(...))` handling in
 * pdfPreview.js, which is what lets the bare specifier below resolve at
 * all) is what makes that possible.
 */
import "./mapUpsertPolyfill.js";
import "pdfjs-dist/build/pdf.worker.mjs";

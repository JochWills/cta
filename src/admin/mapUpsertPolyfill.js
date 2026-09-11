/**
 * Polyfill for Map/WeakMap.prototype.getOrInsertComputed — part of the very
 * recent "Upsert" proposal. pdfjs-dist 6.x calls it directly, all over both
 * its main-thread and worker-thread bundles, with no fallback of its own;
 * Safari (as of whatever version is current when you're reading this)
 * doesn't have it yet, so every one of those calls throws there.
 *
 * Imported from two places for two different realms — see pdfPreview.js
 * (main thread) and pdfjsWorkerEntry.js (the pdf.js worker's own global
 * scope, which shares nothing with the page that spawned it, so the same
 * fix has to run there separately too).
 */
function install(Ctor) {
  if (Ctor.prototype.getOrInsertComputed) return;
  Ctor.prototype.getOrInsertComputed = function (key, compute) {
    if (this.has(key)) return this.get(key);
    const value = compute(key);
    this.set(key, value);
    return value;
  };
}

install(Map);
install(WeakMap);

import { state, $, esc, rands, slugifyCode } from "./state.js";
import { MOD, MODULES, isFreebie, courseOf, moduleName } from "./catalogue.js";
import { previewPageUrl, pagesLabel, BUNDLE_TIERS, renderModules, renderFilters, renderProducts } from "./render.js";
import { track } from "./presence.js";
import { freebieViewer } from "./freebies.js";

/**
 * A note's own page, /notes/<slug> — for Google and shared links, not for
 * browsing (the shop's popup does that). It's the normal shop page: the
 * build writes a copy of index.html per note with that note's title,
 * description and cover in the <head> (see notePages in vite.config.js), and
 * this shows the note at the top, then the shop below it set to the same
 * module, so a visitor who arrived for one note keeps shopping. The hero and
 * the notebook shelf are hidden on these pages (.is-note-page in styles.css).
 *
 * <slug> is slugifyCode(code), the same as the preview images' file names.
 */
const match = location.pathname.match(/^\/notes\/([a-z0-9-]+)\/?$/);
export const noteSlug = match ? match[1] : null;
export const isNotePage = Boolean(noteSlug);

export const noteUrl = (p) => `/notes/${slugifyCode(p.code)}`;

/** Before the first render, so the hero never flashes up on a note page. */
export function initNotePage() {
  if (!isNotePage) return;
  document.body.classList.add("is-note-page");
  $("#noteDetail").hidden = false;
  document.querySelector(".site-header .logo").href = "/";
  $("#shop .shop-head h2").textContent = "More notes";
  $("#shop .shop-head .sub").textContent = "Add a few more — 5+ notes saves you 10%, 10+ saves 15%.";
}

let current = null;

/** Once the products have loaded. */
export function renderNotePage() {
  if (!isNotePage) return;
  current = state.products.find((p) => slugifyCode(p.code) === noteSlug) || null;
  const box = $("#noteDetail .wrap");

  if (!current) {
    document.title = "Note not found | PGDA Notes by Courts";
    box.innerHTML = `
      <div class="note-missing">
        <h1>This note isn't available any more</h1>
        <p>It may have been renamed or taken down. Everything that's for sale is in the shop below.</p>
        <a class="btn" href="#shop">Browse notes</a>
      </div>`;
    return;
  }

  const p = current;
  const m = MOD[p.module_slug] || MODULES[0];
  const free = isFreebie(p);
  document.title = `${p.title} — ${free ? "free" : moduleName(m)} notes | PGDA Notes by Courts`;
  track("preview");

  // The shop below opens on this note's module.
  state.course = courseOf(p.module_slug);
  state.activeFilter = p.module_slug;
  renderModules();
  renderFilters();
  renderProducts();

  const pages = !free && p.preview_pages > 0
    ? Array.from({ length: p.preview_pages }, (_, i) => {
        const page = i + 1;
        return `
        <div class="preview-page" style="--i:${i}">
          <img class="preview-img" src="${esc(previewPageUrl(p.module_slug, p.code, page))}" alt="Page ${page} of ${esc(p.title)}">
          ${page === p.preview_pages ? `<div class="preview-blur-panel"><span>Buy to see the rest</span></div>` : ""}
        </div>`;
      }).join("")
    : free
      ? `<div class="note-pages-empty" id="noteFreebieView"><p>Loading preview…</p></div>`
      : `<div class="note-pages-empty"><p>No preview for this note yet.</p></div>`;
  const [big, small] = BUNDLE_TIERS;

  box.innerHTML = `
    <nav class="note-crumbs" aria-label="Breadcrumb">
      <a href="/">Shop</a><span aria-hidden="true">/</span>
      <a href="#shop" data-jump="${esc(p.module_slug)}">${esc(moduleName(m))}</a><span aria-hidden="true">/</span>
      <span aria-current="page">${esc(p.title)}</span>
    </nav>
    <div class="note-layout">
      <div class="note-pages${free ? " is-doc" : ""}">
        ${!free && p.preview_pages > 0
          ? `<span class="preview-chip">Previewing ${p.preview_pages} of ${pagesLabel(p.page_count || p.preview_pages)}</span>`
          : ""}
        ${pages}
      </div>
      <aside class="note-side">
        <span class="tag" style="background:${m.tint};color:${m.ink}">${esc(moduleName(m))}</span>
        <h1>${esc(p.title)}</h1>
        <p class="preview-pages">${free ? "Free download" : p.page_count ? `PDF · ${pagesLabel(p.page_count)}` : "PDF"}</p>
        ${p.description ? `<p class="preview-desc">${esc(p.description)}</p>` : ""}
        <div class="note-buy">
          <div class="preview-price-row">
            <span class="preview-price">${free ? "Free" : rands(p.price_cents)}</span>
            ${free ? "" : `<span class="preview-bundle">Save ${small.percent}% on ${small.min}+ notes, ${big.percent}% on ${big.min}+</span>`}
          </div>
          <div id="noteBuyBtn"></div>
          <p class="note">${free ? "Free — just your name and email to download." : "Preview only — the rest unlocks once you buy it."}</p>
        </div>
        ${free ? "" : `
        <ul class="preview-assure">
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>Instant download after payment</li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>PDF for laptop, tablet, phone or print</li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6z"/><path d="M9 12.2l2.2 2.2 4-4.4"/></svg>Secure checkout with Paystack</li>
        </ul>`}
      </aside>
    </div>`;
  renderNoteBuy();
  if (free) showFreebie(p);
}

/** A freebie shows the whole file in place (the same viewer as the popup). */
async function showFreebie(p) {
  const view = await freebieViewer(p);
  const slot = document.getElementById("noteFreebieView");
  if (!slot || current !== p) return;
  if (!view) {
    slot.innerHTML = `<p>Couldn't load the preview just now. You can still download it.</p>`;
    return;
  }
  slot.outerHTML = view.html;
  const label = document.querySelector("#noteDetail .preview-pages");
  if (label) label.textContent = view.label;
}

/** The buy button, which changes once the note is in the cart. */
function renderNoteBuy() {
  const slot = document.getElementById("noteBuyBtn");
  if (!slot || !current) return;
  const p = current;
  if (isFreebie(p)) {
    slot.innerHTML = `<button class="btn" type="button" data-freebie="${esc(p.id)}">Download for free</button>`;
    return;
  }
  const inCart = state.cart.some((c) => c.id === p.id);
  // Once it's in the cart: carry on browsing the module below, or go to the cart.
  slot.innerHTML = inCart
    ? `<p class="note-added"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Added to your cart</p>
       <div class="note-buy-actions">
         <a class="btn" href="#shop">Keep shopping</a>
         <button class="btn ghost" type="button" data-open-cart>Go to cart</button>
       </div>`
    : `<button class="btn" type="button" data-add="${esc(p.id)}">Add to cart</button>`;
}

document.addEventListener("cartchange", renderNoteBuy);

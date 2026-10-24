import { COURSES, MODULES, MOD, isFreebie, courseOf, modulesIn, moduleName } from "./catalogue.js";
import { state, rands, esc, $, slugifyCode } from "./state.js";
import { publicStorageUrl } from "./supabase.js";
import { loadFreebiePreview } from "./freebies.js";
import { track } from "./presence.js";

/**
 * e.g. ("taxation", "tax3-a1b2", 2) -> full URL for page 2's preview image.
 * Must match previewPagePath in src/admin/main.js exactly — see the note
 * on slugifyCode in state.js.
 */
export function previewPageUrl(module_slug, code, page) {
  return publicStorageUrl("note-previews", `${module_slug}/${slugifyCode(code)}-p${page}.png`);
}

/* ------------------------------------------------------------------
   Courses. The bridging course only shows (its switch, its shelf and
   anything marked data-bridging-only in index.html) once it has at least
   one live note, so the shop never offers an empty course.
------------------------------------------------------------------ */
export const hasBridging = () => state.products.some((p) => courseOf(p.module_slug) === "bridging");

export function renderCourses() {
  const show = hasBridging();
  if (!show && state.course !== "pgda") {
    state.course = "pgda";
    state.activeFilter = "all";
  }
  $("#courseSwitch").hidden = !show;
  $("#courseSwitch").innerHTML = COURSES.map(
    (c) => `<button type="button" role="tab" aria-selected="${state.course === c.slug}"
      class="${state.course === c.slug ? "is-on" : ""}" data-course="${c.slug}">${esc(c.name)}</button>`
  ).join("");
  document.querySelectorAll("[data-bridging-only]").forEach((el) => (el.hidden = !show));
  renderShopMenu();
}

/** The header's Shop hover menu (desktop only): the courses down the left,
 * and the modules of whichever one is hovered on the right, each a jump
 * straight to that module (data-jump, handled like the footer's links). */
function renderShopMenu() {
  const menu = $("#shopMenu");
  if (!menu || menu.hidden) return;
  const paid = state.products.filter((p) => !isFreebie(p));
  const count = (pred) => paid.filter(pred).length;
  const arrow = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

  const courses = COURSES.map(
    (c) => `
      <a href="#shop" class="shop-menu-course" data-shop-course="${esc(c.slug)}">
        <span>${esc(c.name)}</span>
        <span class="shop-menu-count">${count((p) => courseOf(p.module_slug) === c.slug)}</span>${arrow}
      </a>`
  ).join("");

  const panels = COURSES.map((c) => {
    const rows = modulesIn(c.slug)
      .filter((m) => !m.free)
      .map(
        (m) => `
        <a href="#shop" class="shop-menu-module" data-jump="${esc(m.slug)}" style="--tint:${m.tint};--mod-ink:${m.ink}">
          <span class="shop-menu-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg></span>
          <span>${esc(m.short)}</span>
          <span class="shop-menu-count">${count((p) => p.module_slug === m.slug)}</span>
        </a>`
      )
      .join("");
    return `
      <div class="shop-menu-panel" data-panel="${esc(c.slug)}">
        ${rows}
        <a href="#shop" class="shop-menu-all" data-shop-course="${esc(c.slug)}">All ${esc(c.name)} notes
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>`;
  }).join("");

  menu.dataset.course = state.course;
  const free = `<a href="#shop" class="shop-menu-free" data-jump="freebies">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9z"/></svg>Freebies</a>`;
  menu.innerHTML = `<div class="shop-menu-courses">${courses}${free}</div><div class="shop-menu-panels">${panels}</div>`;
}

/* ------------------------------------------------------------------
   Module cards — the shelf shows the course the switch is on
------------------------------------------------------------------ */
function notebook(m) {
  const count = state.products.filter((p) => p.module_slug === m.slug).length;
  return `
    <div class="nb-slot">
    <button class="module-card" data-jump="${m.slug}" style="--m-tint:${m.tint};--m-ink:${m.ink}">
      <span class="nb-spine" aria-hidden="true"></span>
      <span class="nb-band" aria-hidden="true"></span>
      <span class="nb-label">
        <h3>${esc(m.name)}</h3>
        <span class="module-num">${count}<i>${count === 1 ? "note" : "notes"}</i></span>
      </span>
      <span class="module-link">View notes
        <svg viewBox="0 0 16 10"><path d="M1 5h13M10 1l4 4-4 4"/></svg>
      </span>
    </button>
    </div>`;
}

export function renderModules() {
  renderCourses(); // first — it may fall back to PGDA if bridging has no notes
  $("#moduleGrid").innerHTML = modulesIn(state.course).filter((m) => !m.free).map(notebook).join("");
}

/* ------------------------------------------------------------------
   Filter chips
------------------------------------------------------------------ */
export function renderFilters() {
  const items = [{ slug: "all", short: "All notes" }, ...modulesIn(state.course)];
  $("#filters").innerHTML = items
    .map(
      (m) => `
    <button class="chip ${state.activeFilter === m.slug ? "is-on" : ""}" data-filter="${m.slug}">
      ${esc(m.short)}
    </button>`
    )
    .join("");
  renderModuleMenu();
}

/* ------------------------------------------------------------------
   Module dropdown — phones only, in place of the chips (styles.css
   swaps them). Same options as the chips, each with its module's
   colour, icon and note count. Re-rendered with the grid so the counts
   stay right; the button's label only animates when the module changes.
------------------------------------------------------------------ */
let shownModule = null;

function renderModuleMenu() {
  const items = [{ slug: "all", short: "All notes", tint: "var(--blush)", ink: "var(--accent)", icon: ALL_ICON }, ...modulesIn(state.course)];
  const current = items.find((m) => m.slug === state.activeFilter) || items[0];
  const swatch = (m) => `<svg viewBox="0 0 24 24" style="stroke:${m.ink}">${m.icon}</svg>`;

  $("#moduleToggleSwatch").style.background = current.tint;
  $("#moduleToggleSwatch").innerHTML = swatch(current);
  $("#moduleToggleLabel").textContent = current.short;
  if (shownModule !== null && shownModule !== current.slug) {
    for (const el of [$("#moduleToggleLabel"), $("#moduleToggleSwatch")]) {
      el.classList.remove("is-changed");
      void el.offsetWidth; // restart the animation
      el.classList.add("is-changed");
    }
  }
  shownModule = current.slug;

  $("#moduleList").innerHTML = items
    .map((m, i) => {
      const on = m.slug === current.slug;
      const count = productsFor(m.slug).length;
      return `
    <button type="button" class="module-option${on ? " is-on" : ""}${count ? "" : " is-empty"}" role="option"
            aria-selected="${on}" data-filter="${m.slug}" style="--i:${i}">
      <span class="select-swatch" style="background:${m.tint}">${swatch(m)}</span>
      <span class="select-name">${esc(m.short)}<span class="select-count">${count} ${count === 1 ? "note" : "notes"}</span></span>
      <span class="module-check" aria-hidden="true">${on ? CHECK_ICON : ""}</span>
    </button>`;
    })
    .join("");
}

export function toggleModuleMenu(open = $("#moduleList").hidden) {
  if ($("#moduleList").hidden === !open) return;
  if (open) toggleSelectMenu(false);
  $("#moduleList").hidden = !open;
  $("#moduleToggle").setAttribute("aria-expanded", String(open));
  if (open) ($("#moduleList .is-on") || $("#moduleList .module-option"))?.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------
   Product grid
------------------------------------------------------------------ */
export const pagesLabel = (n) => `${n} page${n === 1 ? "" : "s"}`;

const isNewProduct = (p) => p.created_at && Date.now() - new Date(p.created_at).getTime() < 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------
   "Select" menu — add a whole module, or everything, to the cart.
   Each option only counts what isn't in the cart yet.
------------------------------------------------------------------ */
export const productsFor = (slug) =>
  slug === "all"
    ? state.products.filter((p) => courseOf(p.module_slug) === state.course)
    : state.products.filter((p) => p.module_slug === slug);

/** productsFor, minus freebies — they're downloaded, never added to the cart. */
export const buyableFor = (slug) => productsFor(slug).filter((p) => !isFreebie(p));

const ALL_ICON =
  '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderSelectMenu() {
  const options = [{ slug: "all", name: "All notes", tint: "var(--blush)", ink: "var(--accent)", icon: ALL_ICON }, ...modulesIn(state.course)]
    .filter((m) => !m.free)
    .map((m) => ({ ...m, list: buyableFor(m.slug) }))
    .filter((m) => m.list.length);
  $("#selectMenu").hidden = buyableFor("all").length < 2;

  const rows = options.map((m) => {
    const missing = m.list.filter((p) => !state.cart.some((c) => c.id === p.id));
    const total = missing.reduce((sum, p) => sum + p.price_cents, 0);
    // The bundle tier the cart would reach with these added, same rounding as price_order().
    const percent = bundlePercent(state.cart.length + missing.length);
    const count = missing.length < m.list.length ? `${missing.length} of ${m.list.length} notes` : `${m.list.length} notes`;
    const price = !missing.length
      ? `<span class="select-done">${CHECK_ICON}In your cart</span>`
      : `${percent ? `<s>${rands(total)}</s>` : ""}<strong>${rands(total - Math.round((total * percent) / 100))}</strong>`;
    return `
    <button type="button" class="select-item${m.slug === "all" ? " is-all" : ""}" role="menuitem"
            data-select="${m.slug}" ${missing.length ? "" : "disabled"}>
      <span class="select-swatch" style="background:${m.tint}">
        <svg viewBox="0 0 24 24" style="stroke:${m.ink}">${m.icon}</svg>
      </span>
      <span class="select-name">
        ${esc(m.name)}
        <span class="select-count">${missing.length ? count : `${m.list.length} notes`}${
          missing.length && percent ? `<span class="select-save">${percent}% off</span>` : ""
        }</span>
      </span>
      <span class="select-price">${price}</span>
    </button>`;
  });

  $("#selectList").innerHTML = `
    <p class="select-head">Add a whole module</p>
    ${rows.join("")}
    <p class="select-foot">Bundle discount: 5+ notes 10% off, 10+ notes 15% off</p>`;
}

export function toggleSelectMenu(open = $("#selectList").hidden) {
  if (open && !$("#moduleList").hidden) toggleModuleMenu(false);
  $("#selectList").hidden = !open;
  $("#selectToggle").setAttribute("aria-expanded", String(open));
  if (open) $("#selectList .select-item:not([disabled])")?.focus();
}

export function renderProducts() {
  renderSelectMenu();
  renderModuleMenu();
  const grid = $("#productGrid");
  const base = productsFor(state.activeFilter);
  // New notes float to the top of the grid while their badge shows (24h).
  // Array#sort is stable, so within "new" and within "not new" the existing
  // sort_order is kept — this only moves the new/old boundary, nothing else.
  const list = [...base].sort((a, b) => isNewProduct(b) - isNewProduct(a));

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">
      No notes here yet.
    </div>`;
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const m = MOD[p.module_slug] || MODULES[0];
      const inCart = state.cart.some((c) => c.id === p.id);
      const isNew = isNewProduct(p);
      const free = isFreebie(p);
      return `
    <article class="card" style="--m-tint:${m.tint};--m-ink:${m.ink}" ${p.preview_pages > 0 || free ? `data-preview="${esc(p.id)}"` : ""}>
      ${
        isNew
          ? `<span class="new-badge">New</span>`
          : ""
      }
      <span class="tag">${esc(m.tag)}</span>
      <h3><a class="card-link" href="/notes/${esc(slugifyCode(p.code))}">${esc(p.title)}</a></h3>
      <p>${esc(p.description || "")}</p>
      <button class="card-more" type="button" data-more hidden>Read more</button>
      <div class="card-foot">
        <span class="price-block">
          <span class="price">${free ? "Free" : rands(p.price_cents)}</span>
          ${p.page_count ? `<span class="page-count">${pagesLabel(p.page_count)}</span>` : ""}
        </span>
        ${
          free
            ? `<button class="add-btn"
                data-freebie="${esc(p.id)}" aria-label="Download ${esc(p.title)} for free">
                <svg viewBox="0 0 24 24" style="stroke:currentColor"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>
              </button>`
            : `<button class="add-btn"
                data-add="${esc(p.id)}"
                aria-label="${inCart ? "Already in cart" : "Add " + esc(p.title) + " to cart"}">
          ${
            inCart
              ? '<svg viewBox="0 0 24 24" style="stroke:currentColor"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
              : '<svg viewBox="0 0 24 24" style="stroke:currentColor"><path d="M3 4h2l2.2 10.4a1.8 1.8 0 0 0 1.8 1.4h7.3a1.8 1.8 0 0 0 1.8-1.4L19.5 8H6"/><circle cx="10" cy="19.5" r="1.2"/><circle cx="17" cy="19.5" r="1.2"/></svg>'
          }
        </button>`
        }
      </div>
    </article>`;
    })
    .join("");
  syncCardMore();
}

/** Show "Read more" only on cards whose description is cut off at 4 lines
 * (the clamp is in styles.css). Re-checked on resize and once the web
 * fonts load, since both change where the text wraps. */
function syncCardMore() {
  document.querySelectorAll("#productGrid .card").forEach((card) => {
    if (card.classList.contains("is-open")) return;
    const desc = card.querySelector("p");
    card.querySelector(".card-more").hidden = desc.scrollHeight <= desc.clientHeight + 1;
  });
}
let moreTimer;
window.addEventListener("resize", () => {
  clearTimeout(moreTimer);
  moreTimer = setTimeout(syncCardMore, 150);
});
document.fonts?.ready.then(syncCardMore);

/* ------------------------------------------------------------------
   Cart drawer
------------------------------------------------------------------ */
export const cartTotal = () => state.cart.reduce((sum, i) => sum + i.price_cents, 0);

/** Mirrors price_order() in supabase/schema.sql — that's what actually
 * charges these; the cart only shows them. Highest tier first. */
export const BUNDLE_TIERS = [
  { min: 10, percent: 15 },
  { min: 5, percent: 10 },
];
const bundlePercent = (count = state.cart.length) => BUNDLE_TIERS.find((t) => count >= t.min)?.percent || 0;

/** The one discount that applies. A code and a bundle don't stack — the
 * higher % wins, a code winning a tie — same rule as price_order(). */
function appliedDiscount() {
  const bundle = bundlePercent();
  if (state.discount && state.discount.percent >= bundle) return { label: "Discount", percent: state.discount.percent, isCode: true };
  if (bundle) return { label: "Bundle discount", percent: bundle, isCode: false };
  return null;
}

/** Same rounding as price_order(), so the total shown is the total Paystack charges. */
export const discountCents = () => {
  const d = appliedDiscount();
  return d ? Math.round((cartTotal() * d.percent) / 100) : 0;
};
export const totalDue = () => cartTotal() - discountCents();

function totalsHtml(totalLabel) {
  const d = appliedDiscount();
  if (!d) return `<div class="totals"><span class="lbl">${totalLabel}</span><span class="val">${rands(cartTotal())}</span></div>`;
  return `
    <div class="totals totals-sub"><span class="lbl">Subtotal</span><span>${rands(cartTotal())}</span></div>
    <div class="totals totals-sub"><span class="lbl">${d.label} (${d.percent}%)</span><span>−${rands(discountCents())}</span></div>
    <div class="totals"><span class="lbl">${totalLabel}</span><span class="val">${rands(totalDue())}</span></div>`;
}

/** "Add 2 more notes for 10% off your cart" — nothing once the top tier is reached. */
function bundleNudge() {
  const next = [...BUNDLE_TIERS].reverse().find((t) => state.cart.length < t.min);
  if (!next) return "";
  const more = next.min - state.cart.length;
  return `<p class="bundle-nudge">Add ${more} more note${more === 1 ? "" : "s"} for ${next.percent}% off your cart.</p>`;
}

export function renderDrawer() {
  const body = $("#drawerBody");
  const foot = $("#drawerFoot");
  const title = $("#drawerTitle");

  if (state.checkoutStep === "done") {
    title.textContent = "Order placed";
    body.innerHTML = `
      <div class="ok-panel">
        <div class="ring"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h3>Thanks — you're in</h3>
        <p>Your order is saved. Once payment is wired up, this is where your download
           links will show up automatically.</p>
        <span class="ref">${esc(state.lastOrderRef)}</span>
      </div>`;
    foot.innerHTML = `<button class="btn ghost" id="keepShopping">Keep browsing notes</button>`;
    return;
  }

  if (!state.cart.length) {
    title.textContent = "Your cart";
    body.innerHTML = `<div class="empty-state" style="margin-top:26px;">
      Nothing here yet.<br>Pick the sections you need.
    </div>`;
    foot.innerHTML = `<button class="btn ghost" id="keepShopping">Browse notes</button>`;
    return;
  }

  const lines = state.cart
    .map((i) => {
      const m = MOD[i.module_slug] || MODULES[0];
      return `
    <div class="line">
      <span class="line-swatch" style="background:${m.tint}">
        <svg viewBox="0 0 24 24" style="stroke:${m.ink}">${m.icon}</svg>
      </span>
      <div>
        <h4>${esc(i.title)}</h4>
        <div class="meta">${m.course === "pgda" ? "PGDA · " : ""}${esc(moduleName(m))} · PDF</div>
        <button class="rm" data-rm="${esc(i.id)}">Remove</button>
      </div>
      <span class="amt">${rands(i.price_cents)}</span>
    </div>`;
    })
    .join("");

  if (state.checkoutStep === "cart") {
    title.textContent = "Your cart";
    body.innerHTML = lines;
    foot.innerHTML = `
      ${bundleNudge()}
      ${totalsHtml(`${state.cart.length} section${state.cart.length > 1 ? "s" : ""} · total`)}
      <button class="btn" id="toDetails">Continue to checkout</button>
      <p class="note">Digital download. Nothing is shipped.</p>`;
    return;
  }

  // "details" step
  title.textContent = "Your details";
  body.innerHTML = `
    ${lines}
    <label class="field"><span>Full name</span>
      <input type="text" id="buyerName" placeholder="Jane Doe" autocomplete="name"></label>
    <label class="field"><span>Email for your notes</span>
      <input type="email" id="buyerEmail" placeholder="you@example.com" autocomplete="email"></label>
    <p class="note" style="text-align:left;margin-top:10px;">
      Your notes are matched to this address — check it's right, so you can find them again after paying.</p>
    <div id="discountBox"></div>
    <label class="terms-field">
      <input type="checkbox" id="acceptTerms">
      <span>I've read the <a href="/terms" target="_blank" rel="noopener">terms</a> and
        <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>, and understand this
        purchase is final — notes are digital and delivered instantly, so there are no refunds,
        including if I change my mind.</span>
    </label>
    <div id="checkoutError"></div>`;
  foot.innerHTML = `
    <div id="checkoutTotals"></div>
    <button class="btn" id="placeOrder">Place order</button>
    <button class="btn ghost" id="backToCart" style="margin-top:10px;">Back to cart</button>`;
  renderDiscount();
}

/**
 * Just the discount field and the totals on the details step — applying or
 * removing a code re-renders these two spots only, not the whole drawer,
 * which would wipe the name/email the buyer has already typed.
 */
export function renderDiscount() {
  const box = $("#discountBox");
  const totals = $("#checkoutTotals");
  if (!box || !totals) return;

  const d = appliedDiscount();
  box.innerHTML = state.discount
    ? `<div class="discount-applied">
         <span><strong>${esc(state.discount.code)}</strong> · ${state.discount.percent}% off</span>
         <button class="rm" id="removeDiscount" type="button">Remove</button>
       </div>
       ${d && !d.isCode ? `<p class="note discount-note">Your ${d.percent}% bundle discount is higher, so that's used instead — they don't combine.</p>` : ""}`
    : `<div class="field">
         <span>Discount code</span>
         <div class="discount-row">
           <input type="text" id="discountInput" aria-label="Discount code" autocomplete="off"
                  autocapitalize="characters" spellcheck="false" maxlength="32">
           <button class="btn ghost" id="applyDiscount" type="button">Apply</button>
         </div>
       </div>
       <div id="discountError"></div>`;

  totals.innerHTML = totalsHtml("Total due");
}

export function openCart() {
  $("#drawer").classList.add("is-open");
  $("#scrim").classList.add("is-open");
  document.body.style.overflow = "hidden";
}

export function closeCart() {
  $("#drawer").classList.remove("is-open");
  $("#scrim").classList.remove("is-open");
  document.body.style.overflow = "";
}

export function updateCartCount() {
  $("#cartCount").textContent = state.cart.length;
}

/** Re-render everything that depends on cart contents. */
export function syncCart() {
  updateCartCount();
  renderProducts();
  renderDrawer();
  document.dispatchEvent(new Event("cartchange")); // the note page's buy button (note-page.js)
}

/* ------------------------------------------------------------------
   Preview modal — up to the first 3 pages of a note, stacked and
   scrollable, with the lower portion of the *last* one blurred/faded so a
   shopper can judge the note without it being usable in place of buying
   it. (A note under 3 pages just shows everything it has — same idea,
   the last page shown is still the one that fades out.) The images
   themselves are generated once, at upload time, by the admin page
   (src/admin/pdfPreview.js) — this side just displays them.
------------------------------------------------------------------ */
export function openPreview(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const m = MOD[p.module_slug] || MODULES[0];
  const free = isFreebie(p);
  track("preview");
  $("#previewModal").classList.toggle("is-wide", free);

  if (free) {
    loadFreebiePreview(p); // the whole file, fetched on open — see freebies.js
  } else if (p.preview_pages > 0) {
    $("#previewFrame").innerHTML = Array.from({ length: p.preview_pages }, (_, i) => {
      const page = i + 1;
      const isLast = page === p.preview_pages;
      const url = previewPageUrl(p.module_slug, p.code, page);
      return `
      <div class="preview-page" style="--i:${i}">
        <img class="preview-img" src="${esc(url)}" alt="Page ${page} of ${esc(p.title)}">
        ${isLast ? `<div class="preview-blur-panel"><span>Buy to see the rest</span></div>` : ""}
      </div>`;
    }).join("");
  } else {
    $("#previewFrame").innerHTML = `<div class="empty-state">No preview available for this section yet.</div>`;
  }

  $("#previewTag").textContent = moduleName(m);
  $("#previewTag").style.background = m.tint;
  $("#previewTag").style.color = m.ink;
  $("#previewTitle").textContent = p.title;
  // The card cuts long descriptions off at 4 lines, so the full text lives here.
  $("#previewDesc").textContent = p.description || "";
  // A freebie may be a spreadsheet — freebies.js fills this in once it knows.
  $("#previewPages").textContent = free ? "" : p.page_count ? `PDF · ${pagesLabel(p.page_count)}` : "PDF";
  // "Previewing 3 of 20 pages" over the pages, when there are page images.
  const chip = $("#previewChip");
  chip.hidden = free || !(p.preview_pages > 0);
  chip.textContent = p.page_count ? `Previewing ${p.preview_pages} of ${pagesLabel(p.page_count)}` : `Previewing ${pagesLabel(p.preview_pages)}`;
  $("#previewPrice").textContent = free ? "Free" : rands(p.price_cents);
  const [big, small] = BUNDLE_TIERS;
  $("#previewBundle").textContent = free ? "" : `Save ${small.percent}% on ${small.min}+ notes, ${big.percent}% on ${big.min}+`;
  const inCart = !free && state.cart.some((c) => c.id === p.id);
  const btn = $("#previewAddBtn");
  delete btn.dataset.add;
  delete btn.dataset.freebie;
  btn.classList.toggle("is-in-cart", inCart);
  if (free) {
    btn.dataset.freebie = p.id;
    btn.textContent = "Download for free";
  } else {
    btn.dataset.add = p.id;
    btn.textContent = inCart ? "Already in your cart" : "Add to cart";
  }
  $("#previewNote").textContent = free
    ? "Free — just your name and email to download."
    : "Preview only — the rest unlocks once you buy it.";

  // The address bar shows the note's own page while the popup is open, so it
  // can be copied and shared; closing (or Back) puts the old address back.
  const url = `/notes/${slugifyCode(p.code)}`;
  if (location.pathname !== url && !previewUrlPushed) {
    history.pushState({ preview: p.id }, "", url);
    previewUrlPushed = true;
  } else if (previewUrlPushed) {
    history.replaceState({ preview: p.id }, "", url);
  }

  $("#previewModal").hidden = false;
  $("#previewFrame").scrollTop = 0;
  syncScrollHint();
  document.body.style.overflow = "hidden";
}

/* "Scroll for more pages" over the pages, while there's more below and the
   visitor hasn't started scrolling. Re-checked as each page image loads,
   since the frame only becomes scrollable once they have a height. */
function syncScrollHint() {
  const f = $("#previewFrame");
  const more = f.scrollHeight - f.clientHeight > 40;
  $("#previewScrollHint").hidden = !more || f.scrollTop > 24;
}
$("#previewFrame").addEventListener("scroll", syncScrollHint, { passive: true });
$("#previewFrame").addEventListener("load", syncScrollHint, true); // img load events don't bubble, so capture

let previewUrlPushed = false;
window.addEventListener("popstate", () => {
  previewUrlPushed = false;
  if (!$("#previewModal").hidden) closePreview();
});

export function closePreview() {
  if (previewUrlPushed) {
    previewUrlPushed = false;
    if (history.state?.preview) history.back();
  }
  $("#previewModal").hidden = true;
  $("#previewFrame").innerHTML = ""; // stops a freebie's viewer loading on behind a closed modal
  document.body.style.overflow = "";
}

/* ------------------------------------------------------------------
   Toast
------------------------------------------------------------------ */
let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 2200);
}

/** Set the active module filter and scroll the shop into view. A module
 * from the other course switches course too; "freebies" (the header's Free
 * link) means the freebies of whichever course is showing. */
export function setFilter(slug) {
  if (slug === "freebies" && state.course !== "pgda") slug = `${state.course}-freebies`;
  if (slug !== "all" && MOD[slug]) state.course = courseOf(slug);
  state.activeFilter = slug;
  renderModules();
  renderFilters();
  renderProducts();
  animateCards();
  document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Switch course from the shop's switch — shows all of it, no scrolling. */
export function setCourse(course) {
  if (course === state.course) return;
  state.course = course;
  state.activeFilter = "all";
  toggleSelectMenu(false);
  renderModules();
  renderFilters();
  renderProducts();
  animateCards();
}

/** After a course or module switch, the new cards rise in gently, one after
 * another (first 12 only, so a long grid doesn't keep animating below the fold). */
function animateCards() {
  document.querySelectorAll("#productGrid .card").forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i, 12) * 70}ms`;
    card.classList.add("is-entering");
    card.addEventListener("animationend", () => card.classList.remove("is-entering"), { once: true });
  });
}

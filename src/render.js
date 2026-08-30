import { MODULES, MOD } from "./catalogue.js";
import { state, rands, esc, $ } from "./state.js";
import { publicStorageUrl } from "./supabase.js";

/* ------------------------------------------------------------------
   Module cards
------------------------------------------------------------------ */
export function renderModules() {
  $("#moduleGrid").innerHTML = MODULES.map(
    (m) => `
    <button class="module-card" data-jump="${m.slug}">
      <span class="module-icon" style="background:${m.tint}">
        <svg viewBox="0 0 24 24" style="stroke:${m.ink}">${m.icon}</svg>
      </span>
      <span>
        <h3>${esc(m.name)}</h3>
        <p>${esc(m.blurb)}</p>
        <span class="module-link">View sections
          <svg viewBox="0 0 16 10"><path d="M1 5h13M10 1l4 4-4 4"/></svg>
        </span>
      </span>
    </button>`
  ).join("");
}

/* ------------------------------------------------------------------
   Filter chips
------------------------------------------------------------------ */
export function renderFilters() {
  const items = [{ slug: "all", short: "All notes" }, ...MODULES];
  $("#filters").innerHTML = items
    .map(
      (m) => `
    <button class="chip ${state.activeFilter === m.slug ? "is-on" : ""}" data-filter="${m.slug}">
      ${esc(m.short)}
    </button>`
    )
    .join("");
}

/* ------------------------------------------------------------------
   Product grid
------------------------------------------------------------------ */
export function renderProducts() {
  const grid = $("#productGrid");
  const list =
    state.activeFilter === "all"
      ? state.products
      : state.products.filter((p) => p.module_slug === state.activeFilter);

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">
      No sections here yet. Add rows to the <strong>products</strong> table in Supabase
      and they'll show up automatically.
    </div>`;
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const m = MOD[p.module_slug] || MODULES[0];
      const inCart = state.cart.some((c) => c.id === p.id);
      return `
    <article class="card">
      <span class="tag" style="background:${m.tint};color:${m.ink}">${esc(m.tag)}</span>
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.description || "")}</p>
      ${p.preview_path ? `<button class="preview-link" data-preview="${esc(p.id)}">Preview this note</button>` : ""}
      <div class="card-foot">
        <span class="price">${rands(p.price_cents)}</span>
        <button class="add-btn" style="background:${m.tint};color:${m.ink}"
                data-add="${esc(p.id)}"
                aria-label="${inCart ? "Already in cart" : "Add " + esc(p.title) + " to cart"}">
          ${
            inCart
              ? '<svg viewBox="0 0 24 24" style="stroke:currentColor"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
              : '<svg viewBox="0 0 24 24" style="stroke:currentColor"><path d="M3 4h2l2.2 10.4a1.8 1.8 0 0 0 1.8 1.4h7.3a1.8 1.8 0 0 0 1.8-1.4L19.5 8H6"/><circle cx="10" cy="19.5" r="1.2"/><circle cx="17" cy="19.5" r="1.2"/></svg>'
          }
        </button>
      </div>
    </article>`;
    })
    .join("");
}

/* ------------------------------------------------------------------
   Cart drawer
------------------------------------------------------------------ */
export const cartTotal = () => state.cart.reduce((sum, i) => sum + i.price_cents, 0);

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
        <p>Your order is saved and your email is on the list. Payment gets wired up next,
           then your download links are sent automatically.</p>
        <span class="ref">${esc(state.lastOrderRef)}</span>
      </div>`;
    foot.innerHTML = `<button class="btn ghost" id="keepShopping">Keep browsing notes</button>`;
    return;
  }

  if (!state.cart.length) {
    title.textContent = "Your cart";
    body.innerHTML = `<div class="empty-state" style="margin-top:26px;">
      Nothing here yet.<br>Pick the sections you need — R25 each.
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
        <div class="meta">${esc(m.name)} · PDF</div>
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
      <div class="totals">
        <span class="lbl">${state.cart.length} section${state.cart.length > 1 ? "s" : ""} · total</span>
        <span class="val">${rands(cartTotal())}</span>
      </div>
      <button class="btn" id="toDetails">Continue to checkout</button>
      <p class="note">Digital download. Nothing is shipped.</p>`;
    return;
  }

  // "details" step
  title.textContent = "Your details";
  body.innerHTML = `
    ${lines}
    <label class="field"><span>Full name</span>
      <input type="text" id="buyerName" placeholder="Courtney Smith" autocomplete="name"></label>
    <label class="field"><span>Email for your notes</span>
      <input type="email" id="buyerEmail" placeholder="you@example.com" autocomplete="email"></label>
    <p class="note" style="text-align:left;margin-top:10px;">
      Your download links and receipt go to this address, so check it's right.</p>
    <div id="checkoutError"></div>`;
  foot.innerHTML = `
    <div class="totals"><span class="lbl">Total due</span><span class="val">${rands(cartTotal())}</span></div>
    <button class="btn" id="placeOrder">Place order</button>
    <button class="btn ghost" id="backToCart" style="margin-top:10px;">Back to cart</button>
    <p class="note">Card, instant EFT and more via Paystack — connecting next.</p>`;
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

/** Re-render everything that depends on cart contents. */
export function syncCart() {
  $("#cartCount").textContent = state.cart.length;
  renderProducts();
  renderDrawer();
}

/* ------------------------------------------------------------------
   Preview modal — a page-1 image with the lower portion blurred/faded,
   so a shopper can judge the note without it being usable in place of
   buying it. The image itself is generated once, at upload time, by the
   admin page (src/admin/pdfPreview.js) — this side just displays it.
------------------------------------------------------------------ */
export function openPreview(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const m = MOD[p.module_slug] || MODULES[0];

  $("#previewFrame").innerHTML = p.preview_path
    ? `
      <img class="preview-img" src="${esc(publicStorageUrl("note-previews", p.preview_path))}" alt="Preview of the first page of ${esc(p.title)}">
      <div class="preview-blur-panel"><span>Buy to see the rest</span></div>`
    : `<div class="empty-state">No preview available for this section yet.</div>`;

  $("#previewTag").textContent = m.name;
  $("#previewTag").style.background = m.tint;
  $("#previewTag").style.color = m.ink;
  $("#previewTitle").textContent = p.title;
  $("#previewAddBtn").dataset.add = p.id;
  $("#previewAddBtn").textContent = state.cart.some((c) => c.id === p.id)
    ? "Already in cart"
    : `Add to cart — ${rands(p.price_cents)}`;

  $("#previewModal").hidden = false;
  document.body.style.overflow = "hidden";
}

export function closePreview() {
  $("#previewModal").hidden = true;
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

/** Set the active module filter and scroll the shop into view. */
export function setFilter(slug) {
  state.activeFilter = slug;
  renderFilters();
  renderProducts();
  document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
}

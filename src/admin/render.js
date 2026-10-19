import { COURSES, MODULES, MOD, isFreebie, modulesIn, moduleShort } from "../catalogue.js";
import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";
import { starsHtml } from "../reviews.js";

/* ------------------------------------------------------------------
   Toast (same pattern as src/render.js — separate #toast element, own bundle)
------------------------------------------------------------------ */
let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
}

/* ------------------------------------------------------------------
   Login / dashboard switch
------------------------------------------------------------------ */
export function showLoggedOut() {
  $("#loginView").hidden = false;
  $("#dashboardView").hidden = true;
  $("#logoutWrap").hidden = true;
  $("#passwordInput").value = "";
  $("#passwordInput")?.focus();
}

export function showLoggedIn() {
  $("#loginView").hidden = true;
  $("#dashboardView").hidden = false;
  $("#logoutWrap").hidden = false;
}

export function loginError(message) {
  $("#loginError").innerHTML = message ? `<div class="err">${esc(message)}</div>` : "";
}

export function setTab(tab) {
  adminState.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
  $("#dashOverview").hidden = tab !== "dashboard";
  $("#ordersView").hidden = tab !== "orders";
  $("#notesView").hidden = tab !== "notes";
  $("#discountsView").hidden = tab !== "discounts";
  $("#reviewsView").hidden = tab !== "reviews";
}

/* ------------------------------------------------------------------
   Orders — status is still read-only (see admin-orders' own comment for
   why), but a row can be deleted.
------------------------------------------------------------------ */
// "free" is a freebie download (free-download) — listed with orders, counted in no stat.
export const STATUS_LABEL = { pending: "Pending", paid: "Paid", failed: "Failed", refunded: "Refunded", free: "Free" };

export function renderOrders() {
  const box = $("#ordersTable");
  if (!adminState.orders.length) {
    box.innerHTML = `<div class="empty-state">No orders yet.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Reference</th><th>Date</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${adminState.orders.map(orderRow).join("")}
        </tbody>
      </table>
    </div>`;
}

function orderRow(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return `
    <tr>
      <td><span class="ref">${esc(o.reference)}</span></td>
      <td>${esc(new Date(o.created_at).toLocaleString("en-ZA"))}</td>
      <td>
        <div>${esc(o.full_name || "—")}</div>
        <div class="meta">${esc(o.email)}</div>
      </td>
      <td>
        <details>
          <summary>${items.length} section${items.length === 1 ? "" : "s"}</summary>
          <ul class="order-items">
            ${items.map((i) => `<li>${esc(i.title)}${o.status === "free" ? "" : ` (${rands(i.price_cents)})`}</li>`).join("")}
          </ul>
        </details>
      </td>
      <td>
        <div>${o.status === "free" ? "—" : rands(o.total_cents)}</div>
        ${
          o.discount_percent
            ? `<div class="meta">${o.discount_code ? esc(o.discount_code) : "Bundle"} · ${esc(o.discount_percent)}% off</div>`
            : ""
        }
      </td>
      <td><span class="status-badge status-${esc(o.status)}">${esc(STATUS_LABEL[o.status] || o.status)}</span></td>
      <td><div class="admin-row-actions"><button class="btn ghost" data-del-order="${esc(o.id)}">Delete</button></div></td>
    </tr>`;
}

/* ------------------------------------------------------------------
   Discount codes — create/delete only. A code can't be edited: orders
   snapshot the code and % they used, so changing a code in place would
   make the list disagree with what past orders show. Delete and re-add.
------------------------------------------------------------------ */
export function renderDiscounts() {
  const box = $("#discountsTable");
  if (!adminState.discounts.length) {
    box.innerHTML = `<div class="empty-state">No discount codes yet.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Code</th><th>Discount</th><th>Created</th><th></th></tr></thead>
        <tbody>
          ${adminState.discounts
            .map(
              (d) => `
            <tr>
              <td><span class="discount-code">${esc(d.code)}</span></td>
              <td>${esc(d.percent_off)}% off</td>
              <td>${esc(new Date(d.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }))}</td>
              <td><div class="admin-row-actions"><button class="btn ghost" data-del-discount="${esc(d.id)}">Delete</button></div></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

/* ------------------------------------------------------------------
   Reviews — waiting ones first, since those are the ones needing a
   decision. Publishing is what puts a review on the homepage.
------------------------------------------------------------------ */
const REVIEW_EXCERPT = 180;

export function renderReviews() {
  const pending = adminState.reviews.filter((r) => !r.is_published).length;
  const badge = $("#reviewsPendingCount");
  badge.textContent = pending;
  badge.hidden = !pending;

  const box = $("#reviewsTable");
  if (!adminState.reviews.length) {
    box.innerHTML = `<div class="empty-state">No reviews yet. Send the link above to someone who's bought notes.</div>`;
    return;
  }

  const rows = [...adminState.reviews].sort((a, b) => a.is_published - b.is_published);
  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Rating</th><th>Review</th><th>Name</th><th>Sent</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const text =
                r.body.length > REVIEW_EXCERPT
                  ? `<details><summary><span class="when-closed">${esc(r.body.slice(0, REVIEW_EXCERPT).trimEnd())}… <span class="review-expand">Read all</span></span><span class="when-open review-expand">Show less</span></summary><div class="review-full">${esc(r.body)}</div></details>`
                  : `<div class="review-full">${esc(r.body)}</div>`;
              return `
            <tr>
              <td>${r.rating ? starsHtml(r.rating, "admin-stars") : `<span class="meta">—</span>`}</td>
              <td class="review-cell">${text}</td>
              <td>${esc(r.name || "Anonymous student")}</td>
              <td>${esc(new Date(r.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }))}</td>
              <td><span class="status-badge ${r.is_published ? "status-paid" : "status-pending"}">${r.is_published ? "Published" : "Waiting"}</span></td>
              <td><div class="admin-row-actions">
                <button class="btn${r.is_published ? " ghost" : ""}" data-publish-review="${esc(r.id)}" data-publish="${r.is_published ? "false" : "true"}">${r.is_published ? "Unpublish" : "Publish"}</button>
                <button class="btn ghost" data-del-review="${esc(r.id)}">Delete</button>
              </div></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

export function discountFormError(message) {
  $("#discountFormError").innerHTML = message ? `<div class="err">${esc(message)}</div>` : "";
}

/* ------------------------------------------------------------------
   Notes (products) — table + add/edit modal
------------------------------------------------------------------ */
export function renderProducts() {
  const box = $("#productsTable");
  if (!adminState.products.length) {
    box.innerHTML = `<div class="empty-state">No notes yet — add one to get started.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Title</th><th>Module</th><th>Price</th><th>Pages</th><th>Active</th><th>PDF</th><th></th>
        </tr></thead>
        <tbody>
          ${adminState.products.map(productRow).join("")}
        </tbody>
      </table>
    </div>`;
}

function productRow(p) {
  const m = MOD[p.module_slug] || MODULES[0];
  return `
    <tr>
      <td>${esc(p.title)}</td>
      <td><span class="tag" style="background:${m.tint};color:${m.ink}">${esc(moduleShort(m))}</span></td>
      <td>${isFreebie(p) ? "Free" : rands(p.price_cents)}</td>
      <td>${p.page_count ? esc(p.page_count) : `<span class="meta">—</span>`}</td>
      <td>${p.is_active ? "Yes" : "No"}</td>
      <td>${p.file_path ? "Yes" : "—"}</td>
      <td>
        <div class="admin-row-actions">
          <button class="btn ghost" data-edit="${esc(p.id)}">Edit</button>
          <button class="btn ghost" data-del="${esc(p.id)}">Delete</button>
        </div>
      </td>
    </tr>`;
}

function moduleOptions(selected) {
  return COURSES.map(
    (c) => `<optgroup label="${esc(c.name)}">${modulesIn(c.slug)
      .map((m) => `<option value="${m.slug}" ${m.slug === selected ? "selected" : ""}>${esc(m.name)}</option>`)
      .join("")}</optgroup>`
  ).join("");
}

/**
 * A freebie is always R0 with no preview (products_free_price in
 * supabase/schema.sql backs the price up), so picking Freebies locks the
 * price and says why; picking a paid module again puts back a real price.
 */
export function syncFreebieFields() {
  const free = isFreebie({ module_slug: $("#pf_module").value });
  const price = $("#pf_price");
  if (free) price.value = "0.00";
  else if (!(parseFloat(price.value) > 0)) price.value = "25.00";
  price.disabled = free;
  $("#pf_free_hint").hidden = !free;
  // Freebies can be a spreadsheet too (admin-upload only accepts one under a freebies folder).
  $("#pf_file").accept = free ? "application/pdf,.xlsx,.xls" : "application/pdf";
  $("#pf_file_label").textContent = free ? "PDF or Excel file" : "PDF";
}

export function openProductForm(product) {
  adminState.editing = product || null;
  $("#productFormTitle").textContent = product ? `Edit ${product.title}` : "Add note";
  $("#pf_id").value = product?.id || "";
  $("#pf_module").innerHTML = moduleOptions(product?.module_slug || MODULES[0].slug);
  $("#pf_title").value = product?.title || "";
  $("#pf_description").value = product?.description || "";
  $("#pf_price").disabled = false;
  $("#pf_price").value = product ? (product.price_cents / 100).toFixed(2) : "25.00";
  $("#pf_sort").value = product?.sort_order ?? 0;
  $("#pf_active").checked = product ? Boolean(product.is_active) : true;
  syncFreebieFields();
  $("#pf_file").value = "";
  // Required unless this note already has a PDF — editing an existing
  // note's title/price shouldn't force a re-upload, but a new one (or an
  // old row saved before this was enforced) must get one now.
  $("#pf_file").required = !product?.file_path;
  $("#pf_file_hint").textContent = product?.file_path ? "Leave blank to keep the current file." : "Required.";
  // The signed URL is fetched on click (see main.js), not here — no point
  // asking Supabase for one on every open when most edits never need it.
  const viewBtn = $("#pf_view_pdf");
  viewBtn.hidden = !product?.file_path;
  viewBtn.disabled = false;
  viewBtn.textContent = "View current file ↗";
  productFormError("");
  $("#productModal").hidden = false;
}

export function closeProductForm() {
  $("#productModal").hidden = true;
  adminState.editing = null;
}

/* ------------------------------------------------------------------
   Delete confirmation — the site's own version of confirm(). Resolves
   true on Delete, false on Cancel / Escape / clicking outside. Cancel
   gets focus when it opens, so a stray Enter never deletes anything.
------------------------------------------------------------------ */
let resolveConfirm = null;
let focusBeforeConfirm = null;

export function confirmDelete({ title, message, confirmLabel = "Delete" }) {
  resolveConfirm?.(false); // a second one opening cancels the first
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmOk").textContent = confirmLabel;
  focusBeforeConfirm = document.activeElement;
  $("#confirmModal").hidden = false;
  $('#confirmModal .btn[data-confirm="cancel"]').focus();
  return new Promise((resolve) => (resolveConfirm = resolve));
}

function closeConfirm(result) {
  if (!resolveConfirm) return;
  $("#confirmModal").hidden = true;
  resolveConfirm(result);
  resolveConfirm = null;
  focusBeforeConfirm?.focus?.();
}

$("#confirmModal").addEventListener("click", (e) => {
  const choice = e.target.closest("[data-confirm]")?.dataset.confirm;
  if (choice) closeConfirm(choice === "ok");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#confirmModal").hidden) closeConfirm(false);
});

export function productFormError(message) {
  $("#productFormError").innerHTML = message ? `<div class="err">${esc(message)}</div>` : "";
}

/* ------------------------------------------------------------------
   Live visitors pop-up (header "online" pill)
------------------------------------------------------------------ */
const STEP_LABEL = { preview: "Opened a preview", cart: "Added to cart", checkout: "Started checkout" };
const DEVICE_LABEL = { mobile: "Phone", tablet: "Tablet", desktop: "Computer", unknown: "Unknown device" };

/** "under a minute" / "4 min" / "1 h 12 min" since `iso`. */
function onSiteFor(iso) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!(mins >= 1)) return "under a minute";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/** Counts per value, biggest first: [["Instagram", 3], ["Direct", 1]]. */
function tally(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Rows the admin has opened, by live_visitors()'s key — kept across the 10-second refresh. */
const openLiveRows = new Set();

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "New visitor" or "Returning · 3rd visit · first came 2 days ago". */
function visitLabel(d) {
  if (!d?.visits) return "";
  if (d.visits === 1) return "New visitor";
  const days = Math.floor((Date.now() - Date.parse(d.first_visit)) / 864e5);
  const first = !(days >= 1) ? "earlier today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `Returning · ${ordinal(d.visits)} visit · first came ${first}`;
}

const clock = (iso) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function liveDetailHtml(r) {
  const d = r.details || {};
  const facts = [
    [d.os && d.browser ? `${d.os} · ${d.browser}` : "", "Device"],
    [d.screen, "Screen"],
    [d.region, "Region"],
    [d.campaign, "Campaign"],
    [visitLabel(d), "Visits"],
    [d.filter, "Filter"],
  ].filter(([v]) => v);
  const trail = Array.isArray(r.trail) ? r.trail : [];
  return `
    <div class="live-detail">
      ${facts.length ? `<dl class="live-facts">${facts.map(([v, k]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      ${
        d.cart?.length
          ? `<div class="live-block"><h4>In cart · ${esc(rands(d.cart_cents || 0))}</h4><ul>${d.cart.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${
        d.previewed?.length
          ? `<div class="live-block"><h4>Previewed</h4><ul>${d.previewed.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${
        trail.length
          ? `<div class="live-block"><h4>Path this visit</h4><ol class="live-trail">${trail
              .map((step) => `<li><time>${esc(clock(step.t))}</time><span>${esc(step.a)}</span></li>`)
              .join("")}</ol></div>`
          : ""
      }
    </div>`;
}

/**
 * `details` is whatever a visitor's browser sent (heartbeat is anon-callable),
 * so anyone could send junk on purpose. Keep only the expected fields, in the
 * expected shapes, so one bad row can't break the whole pop-up. (Everything
 * shown still goes through esc() as usual.)
 */
function cleanDetails(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const text = (v) => (typeof v === "string" ? v.slice(0, 120) : "");
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 30).map((x) => x.slice(0, 120)) : []);
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    os: text(d.os), browser: text(d.browser), screen: text(d.screen), region: text(d.region),
    campaign: text(d.campaign), filter: text(d.filter),
    visits: num(d.visits), first_visit: text(d.first_visit),
    cart: list(d.cart), cart_cents: num(d.cart_cents), previewed: list(d.previewed),
    idle: d.idle === true,
  };
}

export function renderLiveVisitors(rawRows) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).map((r) => ({
    ...r,
    details: cleanDetails(r.details),
    trail: Array.isArray(r.trail) ? r.trail.filter((t) => t && typeof t.a === "string") : [],
  }));
  const body = $("#liveBody");
  const listScroll = body.querySelector(".live-list")?.scrollTop || 0;
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state">Nobody's on the site right now.</div>`;
    return;
  }
  const chips = (pairs, label = (k) => k) =>
    pairs.map(([k, n]) => `<span class="live-chip">${esc(label(k))} <strong>${n}</strong></span>`).join("");
  const inCart = rows.filter((r) => r.cart_count > 0).length;
  const regions = rows.map((r) => ({ region: r.details?.region })).filter((r) => r.region);
  const returning = rows.filter((r) => r.details?.visits > 1).length;
  body.innerHTML = `
    <div class="live-summary">
      <div class="live-stat"><strong>${rows.length}</strong><span>online</span></div>
      <div class="live-stat"><strong>${inCart}</strong><span>with notes in cart</span></div>
      <div class="live-stat"><strong>${rows.filter((r) => /^Checkout|^Paying/.test(r.activity || "")).length}</strong><span>at checkout</span></div>
      <div class="live-stat"><strong>${returning}</strong><span>returning</span></div>
    </div>
    <div class="live-chips">${chips(tally(rows, "source"))}</div>
    <div class="live-chips">${chips(tally(rows, "device"), (k) => DEVICE_LABEL[k] || k)}${regions.length ? chips(tally(regions, "region")) : ""}</div>
    <ul class="live-list">
      ${rows
        .slice()
        .reverse() // newest arrivals first
        .map((r) => {
          const open = openLiveRows.has(r.key);
          const d = r.details || {};
          return `
        <li class="live-row${open ? " is-open" : ""}">
          <button type="button" class="live-row-head" data-live-row="${esc(r.key)}" aria-expanded="${open}">
            <span class="live-row-main">
              <span class="live-activity">${d.idle ? `<span class="live-idle" title="No scrolling or tapping for 30 seconds">Idle</span>` : ""}${esc(r.activity || "Just arrived")}</span>
              <span class="live-meta">${esc(r.source)} · ${esc(d.os ? `${d.os} · ${d.browser}` : DEVICE_LABEL[r.device] || r.device)} · on site ${esc(onSiteFor(r.started_at))}${d.visits > 1 ? ` · ${esc(ordinal(d.visits))} visit` : ""}</span>
            </span>
            <span class="live-row-tags">
              ${r.cart_count ? `<span class="live-tag is-cart">${r.cart_count} in cart${d.cart_cents ? ` · ${esc(rands(d.cart_cents))}` : ""}</span>` : ""}
              ${r.furthest ? `<span class="live-tag">${esc(STEP_LABEL[r.furthest] || r.furthest)}</span>` : ""}
              <svg class="live-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </span>
          </button>
          ${open ? liveDetailHtml(r) : ""}
        </li>`;
        })
        .join("")}
    </ul>`;
  const list = body.querySelector(".live-list");
  if (list) list.scrollTop = listScroll;
}

/** A row's head was clicked: open or close its detail (re-rendered from the last data). */
let lastLiveRows = [];
export function toggleLiveRow(key) {
  if (openLiveRows.has(key)) openLiveRows.delete(key);
  else openLiveRows.add(key);
  renderLiveVisitors(lastLiveRows);
}
export function setLiveRows(rows) {
  lastLiveRows = rows;
  renderLiveVisitors(rows);
}

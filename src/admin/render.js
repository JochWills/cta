import { MODULES, MOD } from "../catalogue.js";
import { $, esc, rands } from "../state.js";
import { adminState } from "./state.js";

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
  $("#ordersView").hidden = tab !== "orders";
  $("#notesView").hidden = tab !== "notes";
}

/* ------------------------------------------------------------------
   Orders (view-only)
------------------------------------------------------------------ */
const STATUS_LABEL = { pending: "Pending", paid: "Paid", failed: "Failed", refunded: "Refunded" };

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
          <th>Reference</th><th>Date</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th>
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
            ${items.map((i) => `<li>${esc(i.title)} (${rands(i.price_cents)})</li>`).join("")}
          </ul>
        </details>
      </td>
      <td>${rands(o.total_cents)}</td>
      <td><span class="status-badge status-${esc(o.status)}">${esc(STATUS_LABEL[o.status] || o.status)}</span></td>
    </tr>`;
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
          <th>Title</th><th>Module</th><th>Price</th><th>Active</th><th>PDF</th><th></th>
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
      <td><span class="tag" style="background:${m.tint};color:${m.ink}">${esc(m.short)}</span></td>
      <td>${rands(p.price_cents)}</td>
      <td>${p.is_active ? "Yes" : "No"}</td>
      <td>${p.file_path ? "Yes" : "—"}</td>
      <td class="admin-row-actions">
        <button class="btn ghost" data-edit="${esc(p.id)}">Edit</button>
        <button class="btn ghost" data-del="${esc(p.id)}">Delete</button>
      </td>
    </tr>`;
}

function moduleOptions(selected) {
  return MODULES.map((m) => `<option value="${m.slug}" ${m.slug === selected ? "selected" : ""}>${esc(m.name)}</option>`).join("");
}

export function openProductForm(product) {
  adminState.editing = product || null;
  $("#productFormTitle").textContent = product ? `Edit ${product.title}` : "Add note";
  $("#pf_id").value = product?.id || "";
  $("#pf_module").innerHTML = moduleOptions(product?.module_slug || MODULES[0].slug);
  $("#pf_title").value = product?.title || "";
  $("#pf_description").value = product?.description || "";
  $("#pf_price").value = product ? (product.price_cents / 100).toFixed(2) : "25.00";
  $("#pf_sort").value = product?.sort_order ?? 0;
  $("#pf_active").checked = product ? Boolean(product.is_active) : true;
  $("#pf_file").value = "";
  productFormError("");
  $("#productModal").hidden = false;
}

export function closeProductForm() {
  $("#productModal").hidden = true;
  adminState.editing = null;
}

export function productFormError(message) {
  $("#productFormError").innerHTML = message ? `<div class="err">${esc(message)}</div>` : "";
}

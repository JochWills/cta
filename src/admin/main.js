import { $, slugifyCode } from "../state.js";
import { adminState, loadSession, saveSession, clearSession } from "./state.js";
import {
  toast,
  showLoggedIn,
  showLoggedOut,
  loginError,
  setTab,
  renderOrders,
  renderProducts,
  openProductForm,
  closeProductForm,
  productFormError,
} from "./render.js";
import {
  AuthError,
  login,
  fetchOrders,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadFile,
  getSignedPdfUrl,
  fetchActiveVisitors,
} from "./api.js";
import { renderPreviewPages } from "./pdfPreview.js";

const PREVIEW_MAX_PAGES = 3;

async function boot() {
  loadSession();
  if (adminState.token) {
    await enterDashboard();
  } else {
    showLoggedOut();
  }
}

async function doLogin() {
  const password = $("#passwordInput").value;
  if (!password) return;
  const btn = $("#loginBtn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  loginError("");
  try {
    const { token, expires_at } = await login(password);
    saveSession(token, expires_at);
    await enterDashboard();
  } catch (err) {
    loginError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Log in";
  }
}

async function enterDashboard() {
  showLoggedIn();
  setTab(adminState.tab);
  await Promise.all([loadOrders(), loadProducts()]);
  startVisitorPoll();
}

const VISITOR_POLL_MS = 15_000;
let visitorPollTimer = null;

async function updateVisitorCount() {
  try {
    const count = await fetchActiveVisitors();
    $("#liveVisitorsCount").textContent = count;
  } catch {
    // Not worth a toast over — the dot just shows whatever it last knew.
  }
}

function startVisitorPoll() {
  updateVisitorCount();
  visitorPollTimer = setInterval(updateVisitorCount, VISITOR_POLL_MS);
}

function stopVisitorPoll() {
  clearInterval(visitorPollTimer);
  visitorPollTimer = null;
}

function handleAuthError() {
  stopVisitorPoll();
  clearSession();
  showLoggedOut();
  loginError("Session expired — log in again");
}

async function loadOrders() {
  try {
    adminState.orders = await fetchOrders();
    renderOrders();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function loadProducts() {
  try {
    adminState.products = await listProducts();
    renderProducts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

function doLogout() {
  stopVisitorPoll();
  clearSession();
  showLoggedOut();
}

/**
 * e.g. ("taxation", "tax3-a1b2", "pdf") -> "taxation/tax3-a1b2.pdf"
 *
 * `code` here is the server-generated identifier from admin-products (see
 * its comment) — the admin page never asks for or shows one anymore, but
 * the returned product row still carries it, and it's what keeps this path
 * (and the preview images') stable across title edits.
 */
function slugPath(module_slug, code, ext) {
  return `${module_slug}/${slugifyCode(code)}.${ext}`;
}

/**
 * e.g. ("taxation", "tax3-a1b2", 2) -> "taxation/tax3-a1b2-p2.png"
 *
 * Must match exactly how the shop derives the same URL (previewPageUrl in
 * src/render.js) — neither side stores the path, both compute it the same
 * way from module_slug + code + page number.
 */
function previewPagePath(module_slug, code, page) {
  return `${module_slug}/${slugifyCode(code)}-p${page}.png`;
}

async function saveProductForm(e) {
  e.preventDefault();
  const btn = $("#saveProduct");
  productFormError("");

  const id = $("#pf_id").value || null;
  const priceRands = parseFloat($("#pf_price").value);
  const fields = {
    title: $("#pf_title").value.trim(),
    description: $("#pf_description").value.trim() || null,
    module_slug: $("#pf_module").value,
    price_cents: Math.round(priceRands * 100),
    sort_order: parseInt($("#pf_sort").value, 10) || 0,
    is_active: $("#pf_active").checked,
  };

  if (!fields.title || Number.isNaN(fields.price_cents)) {
    productFormError("Title and a valid price are required.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const saved = id ? await updateProduct(id, fields) : await createProduct(fields);

    const file = $("#pf_file").files[0];
    if (file) {
      btn.textContent = "Uploading PDF…";
      const { path } = await uploadFile(file, slugPath(saved.module_slug, saved.code, "pdf"), "notes");

      btn.textContent = "Generating preview…";
      const pages = await renderPreviewPages(file, PREVIEW_MAX_PAGES);
      await Promise.all(
        pages.map((png, i) =>
          uploadFile(png, previewPagePath(saved.module_slug, saved.code, i + 1), "note-previews")
        )
      );

      await updateProduct(saved.id, { file_path: path, preview_pages: pages.length });
    }

    closeProductForm();
    toast(id ? "Note updated" : "Note added");
    await loadProducts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    productFormError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function doDelete(id) {
  const product = adminState.products.find((p) => p.id === id);
  if (!product) return;
  if (!confirm(`Delete ${product.title}? This can't be undone.`)) return;
  try {
    await deleteProduct(id);
    toast("Note deleted");
    await loadProducts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function viewCurrentPdf() {
  const filePath = adminState.editing?.file_path;
  if (!filePath) return;
  const btn = $("#pf_view_pdf");
  // Open the tab synchronously, in the same tick as the click, then point
  // it at the real URL once it's back — waiting for the fetch before
  // calling window.open at all gets treated as a non-user-gesture popup
  // and blocked by most browsers.
  //
  // Deliberately not passing "noopener" here: per spec that makes
  // window.open return null, which silently defeats the whole trick —
  // without a reference there's nothing left to redirect, and the tab
  // just sits on about:blank forever (caught by actually clicking this in
  // a browser, not by reading the code). Same end result without that
  // trap: keep the reference, then immediately null its own .opener so
  // the new tab still can't reach back into this one.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  btn.disabled = true;
  btn.textContent = "Opening…";
  try {
    const { url } = await getSignedPdfUrl(filePath);
    if (tab) tab.location.href = url;
  } catch (err) {
    tab?.close();
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "View current PDF ↗";
  }
}

/* ------------------------------------------------------------------
   Delegated events (same pattern as src/main.js)
------------------------------------------------------------------ */
$("#loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  doLogin();
});

$("#productForm").addEventListener("submit", saveProductForm);

document.addEventListener("click", (e) => {
  if (e.target.closest("#logoutBtn")) return doLogout();

  const tab = e.target.closest("[data-tab]");
  if (tab) return setTab(tab.dataset.tab);

  if (e.target.closest("#addNoteBtn")) return openProductForm(null);
  if (e.target.closest("#cancelForm") || e.target.closest("#closeModal")) return closeProductForm();

  const edit = e.target.closest("[data-edit]");
  if (edit) return openProductForm(adminState.products.find((p) => p.id === edit.dataset.edit));

  const del = e.target.closest("[data-del]");
  if (del) return doDelete(del.dataset.del);

  if (e.target.closest("#pf_view_pdf")) return viewCurrentPdf();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#productModal").hidden) closeProductForm();
});

boot();

import { $, esc, rands, slugifyCode } from "../state.js";
import { isFreebie } from "../catalogue.js";
import { adminState, loadSession, saveSession, clearSession } from "./state.js";
import {
  toast,
  showLoggedIn,
  showLoggedOut,
  loginError,
  setTab,
  renderOrders,
  renderCustomers,
  toggleCustomer,
  customerList,
  renderProducts,
  renderDiscounts,
  renderReviews,
  discountFormError,
  setEditingExpiry,
  openProductForm,
  closeProductForm,
  syncFreebieFields,
  productFormError,
  confirmDelete,
  toggleOrderMenu,
  closeOrderMenu,
  setLiveRows,
  toggleLiveRow,
} from "./render.js";
import {
  AuthError,
  login,
  fetchOrders,
  deleteOrder,
  setOrderRefunded,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadFile,
  getSignedPdfUrl,
  fetchActiveVisitors,
  fetchLiveVisitors,
  fetchDailyVisitors,
  fetchVisitorInsights,
  listDiscounts,
  createDiscount,
  deleteDiscount,
  setDiscountExpiry,
  listReviews,
  publishReview,
  deleteReview,
  listReviewRequests,
  requestReview,
  fetchHealth,
  listPayouts,
  listPayoutSales,
} from "./api.js";
import { renderHealth } from "./health.js";
import { remainingMs, addUsage, nextHour, mmss } from "./liveLimit.js";
import { setPayouts, togglePayout } from "./payouts.js";
import { renderPreviewPages, countPdfPages } from "./pdfPreview.js";
import { renderDashboard } from "./dashboard.js";

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
    const remember = $("#rememberInput").checked;
    const { token, expires_at } = await login(password, remember);
    saveSession(token, expires_at, remember);
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
  await Promise.all([loadOrders(), loadProducts(), loadDiscounts(), loadReviews(), loadReviewRequests(), loadDailyVisitors(), loadVisitorInsights()]);
  if (adminState.tab === "payouts") loadPayouts();
  loadHealth(); // not awaited — it checks the live site and Paystack, which takes a few seconds
  startVisitorPoll();
}

/** Not gated behind the admin token (same anon RPC as the live count) — a
 * failure here just leaves the chart empty, not worth a toast over. */
async function loadDailyVisitors() {
  try {
    adminState.dailyVisitors = await fetchDailyVisitors();
    renderDashboard();
  } catch {
    // ignore — chart shows its own empty state
  }
}

const INSIGHT_DAYS = { today: 1, "7": 7, "30": 30, "90": 90, all: 36500 };

/** Sources and journey for the dashboard's current range — refetched when the range changes. Same anon RPC idea as above. */
async function loadVisitorInsights() {
  try {
    adminState.visitorInsights = await fetchVisitorInsights(INSIGHT_DAYS[adminState.dashboardRange] || 30);
    renderDashboard();
  } catch {
    // ignore — the cards show their own empty state
  }
}

const VISITOR_POLL_MS = 10_000; // same as the live pop-up, so the two never disagree for long
let visitorPollTimer = null;

async function updateVisitorCount() {
  try {
    const count = await fetchActiveVisitors();
    $("#liveVisitorsCount").textContent = count;
  } catch {
    // Not worth a toast over — the dot just shows whatever it last knew.
  }
}

// The journey card's badges ("4m ago", "+3 in the last 2 minutes") and its
// counts refresh on their own while the page is open. Orders too, since the
// Paid step's badges come from them.
const INSIGHTS_POLL_MS = 60_000;
let insightsPollTimer = null;

function startVisitorPoll() {
  updateVisitorCount();
  visitorPollTimer = setInterval(updateVisitorCount, VISITOR_POLL_MS);
  insightsPollTimer = setInterval(() => {
    loadVisitorInsights();
    loadOrders(true);
  }, INSIGHTS_POLL_MS);
}

/* ------------------------------------------------------------------
   Live visitors pop-up — opened from the header's "online" pill
------------------------------------------------------------------ */
const LIVE_POLL_MS = 10_000;
let livePollTimer = null;

async function loadLiveVisitors() {
  try {
    const rows = await fetchLiveVisitors();
    $("#liveVisitorsCount").textContent = rows.length;
    // closed, or locked by the time limit, while this was loading
    if (!livePollTimer) return;
    setLiveRows(rows);
  } catch (err) {
    if (err instanceof AuthError) {
      closeLive();
      return handleAuthError();
    }
    $("#liveBody").innerHTML = `<div class="empty-state">Couldn't load who's online. Trying again shortly.</div>`;
  }
}

/* The pop-up has a viewing allowance: 10 minutes per clock hour on this
   device (see liveLimit.js). A one-second tick counts time while it's open
   and in view, shows what's left, and locks it once that runs out — until
   the top of the next hour, when it opens up again by itself. */
let liveTick = null;
let lastTick = 0;

function startLivePolling() {
  if (livePollTimer) return;
  $("#liveBody").innerHTML = `<div class="empty-state">Loading…</div>`;
  loadLiveVisitors();
  livePollTimer = setInterval(loadLiveVisitors, LIVE_POLL_MS);
}

function stopLivePolling() {
  clearInterval(livePollTimer);
  livePollTimer = null;
}

function showLiveLocked() {
  stopLivePolling();
  const at = nextHour().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  $("#liveLimit").hidden = true;
  $("#liveBody").innerHTML = `
    <div class="live-locked">
      <span class="live-locked-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg></span>
      <strong>You've used your 10 minutes for this hour</strong>
      <span>Live view opens again at ${esc(at)} — in <span id="liveUnlockIn">${esc(mmss(nextHour() - Date.now()))}</span>.</span>
    </div>`;
}

function updateLiveLimit() {
  const left = remainingMs();
  const el = $("#liveLimit");
  el.hidden = false;
  el.textContent = `${mmss(left)} left this hour`;
  el.classList.toggle("is-low", left <= 2 * 60 * 1000);
}

function tickLive() {
  const now = Date.now();
  const elapsed = now - lastTick;
  lastTick = now;
  if (livePollTimer && !document.hidden) addUsage(elapsed);

  if (remainingMs() <= 0) {
    if (livePollTimer || !$("#liveUnlockIn")) showLiveLocked();
    const unlock = $("#liveUnlockIn");
    if (unlock) unlock.textContent = mmss(nextHour() - now);
    return;
  }
  // a new hour while locked (or still allowance left): carry on watching
  if (!livePollTimer) startLivePolling();
  updateLiveLimit();
}

function openLive() {
  $("#liveModal").hidden = false;
  lastTick = Date.now();
  tickLive();
  liveTick = setInterval(tickLive, 1000);
}

function closeLive() {
  $("#liveModal").hidden = true;
  stopLivePolling();
  clearInterval(liveTick);
  liveTick = null;
}

function stopVisitorPoll() {
  clearInterval(visitorPollTimer);
  clearInterval(insightsPollTimer);
  visitorPollTimer = insightsPollTimer = null;
}

function handleAuthError() {
  stopVisitorPoll();
  clearSession();
  showLoggedOut();
  loginError("Session expired — log in again");
}

/** `quiet` for the background refresh — a blip there isn't worth a toast every minute. */
/** Health tab — run on login and whenever the tab is opened or "Check again" is clicked. */
let healthRunning = false;
async function loadHealth() {
  if (healthRunning) return;
  healthRunning = true;
  $("#healthRefresh").disabled = true;
  try {
    const issues = renderHealth(await fetchHealth());
    $("#healthAlertCount").hidden = !issues;
    $("#healthAlertCount").textContent = issues;
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    $("#healthBody").innerHTML = `<div class="empty-state">Couldn't run the checks just now. ${err.message}</div>`;
  } finally {
    healthRunning = false;
    $("#healthRefresh").disabled = false;
  }
}

/** Payouts tab — fetched from Paystack the first time it's opened, and on "Refresh". */
let payoutsLoaded = false;
async function loadPayouts() {
  $("#payoutsRefresh").disabled = true;
  try {
    setPayouts(await listPayouts());
    payoutsLoaded = true;
    $("#payoutsChecked").textContent = `What Paystack has paid into your bank. Checked at ${new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}.`;
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    $("#payoutsTable").innerHTML = `<div class="empty-state">Couldn't load payouts just now. ${esc(err.message)}</div>`;
  } finally {
    $("#payoutsRefresh").disabled = false;
  }
}

async function loadReviewRequests() {
  try {
    adminState.reviewRequests = await listReviewRequests();
    renderCustomers();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

/** Customers tab's "Ask for a review" — confirm, then email them the /review link. */
async function doAskReview(email, btn) {
  const c = customerList().find((x) => x.email === email);
  if (!c) return;
  const who = c.name || c.email;
  const ok = await confirmDelete({
    tone: "send",
    title: c.askedAt ? "Ask for a review again?" : "Ask for a review?",
    message: `${who} (${c.email}) gets an email from notes@pgdanotes.co.za asking for a short review, with the review link.${
      c.askedAt ? " You last asked them " + c.askedAt.toLocaleDateString("en-ZA") + "." : ""
    }`,
    confirmLabel: "Send email",
  });
  if (!ok) return;
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const sent = await requestReview(c.email);
    adminState.reviewRequests.unshift(sent);
    toast(`Review request sent to ${who}`);
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
  renderCustomers();
}

async function loadOrders(quiet = false) {
  try {
    adminState.orders = await fetchOrders();
    renderOrders();
    renderCustomers();
    renderDashboard(); // the Dashboard tab is derived entirely from orders — see dashboard.js
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    if (!quiet) toast(err.message);
  }
}

/** Manually re-pulls orders/products — the poll-free Dashboard tab otherwise
 * only ever updates on tab switch or a page reload, so this is how Courts
 * checks for a sale that just came in without either of those. */
async function refreshDashboard() {
  const btn = $("#dashRefreshBtn");
  btn.disabled = true;
  btn.classList.add("is-spinning");
  try {
    await Promise.all([loadOrders(), loadProducts(), loadReviews(), loadDailyVisitors(), loadVisitorInsights()]);
    toast("Dashboard refreshed");
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-spinning");
  }
}

async function loadDiscounts() {
  try {
    adminState.discounts = await listDiscounts();
    renderDiscounts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function saveDiscountForm(e) {
  e.preventDefault();
  const btn = $("#addDiscountBtn");
  const code = $("#df_code").value.trim().toUpperCase();
  const percent = parseInt($("#df_percent").value, 10);
  // datetime-local is this device's local time (SA for Courts); toISOString makes it exact.
  const expiresValue = $("#df_expires").value;
  const expires = expiresValue ? new Date(expiresValue).toISOString() : null;
  discountFormError("");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    await createDiscount(code, percent, expires);
    $("#discountForm").reset();
    toast(`${code} added — ${percent}% off${expires ? ", with an expiry" : ""}`);
    await loadDiscounts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    discountFormError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add code";
  }
}

/** Save (or clear, with null) a code's expiry from the inline editor in its row. */
async function saveExpiry(id, value) {
  try {
    await setDiscountExpiry(id, value ? new Date(value).toISOString() : null);
    toast(value ? "Expiry saved" : "Expiry removed — the code won't expire");
    setEditingExpiry(null);
    await loadDiscounts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function doDeleteDiscount(id) {
  const d = adminState.discounts.find((x) => x.id === id);
  if (!d) return;
  const ok = await confirmDelete({
    title: `Delete ${d.code}?`,
    message: "Buyers won't be able to use it any more. Orders that already used it keep their discount.",
  });
  if (!ok) return;
  try {
    await deleteDiscount(id);
    toast("Discount code deleted");
    await loadDiscounts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function loadReviews() {
  try {
    adminState.reviews = await listReviews();
    renderReviews();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function doPublishReview(id, publish) {
  try {
    await publishReview(id, publish);
    toast(publish ? "Review published — it's on the homepage now" : "Review hidden from the homepage");
    await loadReviews();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function doDeleteReview(id) {
  const r = adminState.reviews.find((x) => x.id === id);
  if (!r) return;
  const ok = await confirmDelete({
    title: "Delete this review?",
    message: `The review from ${r.name || "Anonymous student"} will be removed for good. To only take it off the homepage, use Unpublish instead.`,
  });
  if (!ok) return;
  try {
    await deleteReview(id);
    toast("Review deleted");
    await loadReviews();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

const reviewLink = () => `${location.origin}/review`;

async function copyReviewLink() {
  try {
    await navigator.clipboard.writeText(reviewLink());
    toast("Review link copied");
  } catch {
    toast(`Copy this link: ${reviewLink()}`);
  }
}

async function loadProducts() {
  try {
    adminState.products = await listProducts();
    renderProducts();
    renderDashboard(); // the "sales by module" chart needs products to map an order item back to its module
    backfillPageCounts();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

/**
 * Notes uploaded before page_count existed have it null — read each one's
 * PDF once, quietly in the background, and save the count. One at a time
 * so it never competes much with the rest of the page. Self-healing: a
 * failure just leaves that row null for the next time the admin page loads.
 */
let backfilling = false;
async function backfillPageCounts() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (const p of adminState.products.filter((x) => x.file_path && !x.page_count && !isExcel(x.file_path))) {
      try {
        const { url } = await getSignedPdfUrl(p.file_path);
        const page_count = await countPdfPages(url);
        await updateProduct(p.id, { page_count });
        p.page_count = page_count;
        renderProducts();
      } catch (err) {
        if (err instanceof AuthError) return;
        console.warn(`Couldn't count pages for ${p.title}:`, err.message);
      }
    }
  } finally {
    backfilling = false;
  }
}

function doLogout() {
  closeLive();
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

/** A freebie's spreadsheet — no pages, no preview, nothing for pdf.js to read. */
const isExcel = (name) => /\.xlsx?$/i.test(name);

async function pageCountOf(file) {
  const url = URL.createObjectURL(file);
  try {
    return await countPdfPages(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveProductForm(e) {
  e.preventDefault();
  const btn = $("#saveProduct");
  productFormError("");

  const id = $("#pf_id").value || null;
  const priceRands = parseFloat($("#pf_price").value);
  const free = isFreebie({ module_slug: $("#pf_module").value });
  const fields = {
    title: $("#pf_title").value.trim(),
    description: $("#pf_description").value.trim() || null,
    module_slug: $("#pf_module").value,
    price_cents: free ? 0 : Math.round(priceRands * 100),
    sort_order: parseInt($("#pf_sort").value, 10) || 0,
    is_active: $("#pf_active").checked,
  };
  // Freebies have no preview — and a paid note moved to Freebies stops
  // showing the one it had.
  if (free) fields.preview_pages = 0;

  // R0 is only for freebies: Paystack can't charge it, so a paid note at
  // R0 could never be bought (products_free_price in schema.sql agrees).
  if (!fields.title || !(free || fields.price_cents > 0)) {
    productFormError("Title and a price above R0 are required.");
    return;
  }

  const file = $("#pf_file").files[0];
  const excel = Boolean(file) && isExcel(file.name);
  if (excel && !free) {
    productFormError("Excel files are only for freebies. Paid notes need a PDF.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";

  // A note getting its first PDF stays hidden until that upload has
  // finished, so a failed upload never leaves a buyable note with nothing
  // to download. Switched to what the checkbox says in the final update.
  const holdBack = Boolean(file) && !adminState.editing?.file_path;

  try {
    const first = holdBack ? { ...fields, is_active: false } : fields;
    const saved = id ? await updateProduct(id, first) : await createProduct(first);
    // If the upload below fails, saving again should finish this note, not add a second one.
    $("#pf_id").value = saved.id;
    adminState.editing = saved;

    if (file) {
      btn.textContent = excel ? "Uploading file…" : "Uploading PDF…";
      const ext = excel ? file.name.split(".").pop().toLowerCase() : "pdf";
      const { path } = await uploadFile(file, slugPath(saved.module_slug, saved.code, ext), "notes");

      btn.textContent = free ? "Reading file…" : "Generating preview…";
      const { pages, pageCount } = excel
        ? { pages: [], pageCount: null } // a spreadsheet has no pages
        : free
          ? { pages: [], pageCount: await pageCountOf(file) } // no preview for a freebie, just its page count
          : await renderPreviewPages(file, PREVIEW_MAX_PAGES);
      await Promise.all(
        pages.map((png, i) =>
          uploadFile(png, previewPagePath(saved.module_slug, saved.code, i + 1), "note-previews")
        )
      );

      await updateProduct(saved.id, {
        file_path: path,
        preview_pages: pages.length,
        page_count: pageCount,
        is_active: fields.is_active,
      });
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

/**
 * Deleting an order is permanent and, unlike deleting a note, removes an
 * actual financial record — the confirm text says so plainly for a paid
 * one, and makes clear this doesn't touch Paystack or refund the buyer
 * (that's a separate, deliberate action on Paystack's own side if it's
 * ever needed — this only ever removes the local row).
 */
async function doDeleteOrder(id) {
  const order = adminState.orders.find((o) => o.id === id);
  if (!order) return;
  const ok = await confirmDelete(
    order.status === "paid"
      ? {
          title: "Delete a paid order?",
          message: `${order.reference} · ${rands(order.total_cents)}. This does not refund the buyer — it only removes the record, permanently.`,
        }
      : { title: "Delete this order?", message: `Order ${order.reference} will be removed. This can't be undone.` }
  );
  if (!ok) return;
  try {
    await deleteOrder(id);
    toast("Order deleted");
    await loadOrders();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

/**
 * Marking an order refunded keeps the record (and the buyer's download
 * links) but takes it out of revenue — every stat counts "paid" only. It
 * doesn't move any money: the refund itself is done on Paystack.
 */
async function doRefundOrder(id, refunded) {
  const order = adminState.orders.find((o) => o.id === id);
  if (!order) return;
  const ok = await confirmDelete(
    refunded
      ? {
          title: "Mark as refunded?",
          message: `${order.reference} · ${rands(order.total_cents)} comes off your revenue. The order and its download links stay. This doesn't send the money back — do that on Paystack.`,
          confirmLabel: "Mark refunded",
          tone: "refund",
        }
      : {
          title: "Undo the refund?",
          message: `${order.reference} · ${rands(order.total_cents)} goes back to paid and counts in your revenue again.`,
          confirmLabel: "Mark paid",
          tone: "refund",
        }
  );
  if (!ok) return;
  try {
    await setOrderRefunded(id, refunded);
    toast(refunded ? "Marked refunded" : "Marked paid again");
    await loadOrders();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError();
    toast(err.message);
  }
}

async function doDelete(id) {
  const product = adminState.products.find((p) => p.id === id);
  if (!product) return;

  // order-download finds each bought note's PDF through its products row,
  // so deleting one that's been sold breaks every past buyer's download.
  // Hiding it (is_active false) stops new sales and keeps those working.
  // Pending orders count too — they can still turn paid.
  const buyers = adminState.orders.filter(
    (o) => (o.status === "paid" || o.status === "pending") && (o.items || []).some((i) => i.product_id === id)
  ).length;
  if (buyers) {
    if (!product.is_active) {
      toast("This note has been bought, so it can't be deleted — it's already hidden from the shop");
      return;
    }
    const hide = await confirmDelete({
      title: "This note has been bought",
      message: `${product.title} is in ${buyers} order${buyers === 1 ? "" : "s"}. Deleting it would break ${
        buyers === 1 ? "that buyer's" : "those buyers'"
      } download links, so it can only be hidden from the shop instead.`,
      confirmLabel: "Hide from shop",
    });
    if (!hide) return;
    try {
      await updateProduct(id, { is_active: false });
      toast("Note hidden from the shop");
      await loadProducts();
    } catch (err) {
      if (err instanceof AuthError) return handleAuthError();
      toast(err.message);
    }
    return;
  }

  const ok = await confirmDelete({
    title: "Delete this note?",
    message: `${product.title} will be removed from the shop. This can't be undone.`,
  });
  if (!ok) return;
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
    btn.textContent = "View current file ↗";
  }
}

/* ------------------------------------------------------------------
   Delegated events (same pattern as src/main.js)
------------------------------------------------------------------ */
$("#liveVisitors").addEventListener("click", openLive);
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-live]")) return closeLive();
  const row = e.target.closest("[data-live-row]");
  if (row) toggleLiveRow(row.dataset.liveRow);
});
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#liveModal").hidden && closeLive());

$("#loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  doLogin();
});

$("#productForm").addEventListener("submit", saveProductForm);
$("#pf_module").addEventListener("change", syncFreebieFields);
$("#discountForm").addEventListener("submit", saveDiscountForm);

$("#customerSearch").addEventListener("input", (e) => {
  adminState.customerQuery = e.target.value;
  renderCustomers();
});
$("#customerSort").addEventListener("change", (e) => {
  adminState.customerSort = e.target.value;
  renderCustomers();
});

$("#dashRange").addEventListener("change", (e) => {
  adminState.dashboardRange = e.target.value;
  renderDashboard();
  loadVisitorInsights();
});

document.addEventListener("click", (e) => {
  // Any click closes an open order menu — after this handler has read which
  // item (if any) was picked, since the item is inside the menu being removed.
  const menuBtn = e.target.closest("[data-order-menu]");
  if (menuBtn) return toggleOrderMenu(menuBtn, adminState.orders.find((o) => o.id === menuBtn.dataset.orderMenu));
  queueMicrotask(closeOrderMenu);

  if (e.target.closest("#logoutBtn")) return doLogout();

  const tab = e.target.closest("[data-tab]");
  if (tab) {
    e.preventDefault();
    if (tab.dataset.tab === "health") loadHealth();
    if (tab.dataset.tab === "payouts" && !payoutsLoaded) loadPayouts();
    return setTab(tab.dataset.tab);
  }
  if (e.target.closest("#healthRefresh")) return loadHealth();
  if (e.target.closest("#payoutsRefresh")) return loadPayouts();
  const payout = e.target.closest("[data-payout-toggle]");
  if (payout)
    return togglePayout(payout.dataset.payoutToggle, listPayoutSales).catch((err) => {
      if (err instanceof AuthError) handleAuthError();
    });

  if (e.target.closest("#addNoteBtn")) return openProductForm(null);
  if (e.target.closest("#cancelForm") || e.target.closest("#closeModal")) return closeProductForm();

  const edit = e.target.closest("[data-edit]");
  if (edit) return openProductForm(adminState.products.find((p) => p.id === edit.dataset.edit));

  const del = e.target.closest("[data-del]");
  if (del) return doDelete(del.dataset.del);

  const ask = e.target.closest("[data-ask-review]");
  if (ask) return doAskReview(ask.dataset.askReview, ask);

  const customer = e.target.closest("[data-customer-toggle]");
  if (customer) return toggleCustomer(customer.dataset.customerToggle);

  const refundOrder = e.target.closest("[data-refund-order]");
  if (refundOrder) return doRefundOrder(refundOrder.dataset.refundOrder, true);
  const unrefundOrder = e.target.closest("[data-unrefund-order]");
  if (unrefundOrder) return doRefundOrder(unrefundOrder.dataset.unrefundOrder, false);

  const delOrder = e.target.closest("[data-del-order]");
  if (delOrder) return doDeleteOrder(delOrder.dataset.delOrder);

  const editExpiry = e.target.closest("[data-edit-expiry]");
  if (editExpiry) return setEditingExpiry(editExpiry.dataset.editExpiry);
  const saveExp = e.target.closest("[data-save-expiry]");
  if (saveExp) {
    const input = document.querySelector(`[data-expiry-input="${CSS.escape(saveExp.dataset.saveExpiry)}"]`);
    if (!input?.value) return toast("Pick a date and time, or choose No expiry");
    return saveExpiry(saveExp.dataset.saveExpiry, input.value);
  }
  const clearExp = e.target.closest("[data-clear-expiry]");
  if (clearExp) return saveExpiry(clearExp.dataset.clearExpiry, null);
  if (e.target.closest("[data-cancel-expiry]")) return setEditingExpiry(null);

  const delDiscount = e.target.closest("[data-del-discount]");
  if (delDiscount) return doDeleteDiscount(delDiscount.dataset.delDiscount);

  const pub = e.target.closest("[data-publish-review]");
  if (pub) return doPublishReview(pub.dataset.publishReview, pub.dataset.publish === "true");

  const delReview = e.target.closest("[data-del-review]");
  if (delReview) return doDeleteReview(delReview.dataset.delReview);

  if (e.target.closest("#copyReviewLink")) return copyReviewLink();

  if (e.target.closest("#pf_view_pdf")) return viewCurrentPdf();
  if (e.target.closest("#dashRefreshBtn")) return refreshDashboard();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#productModal").hidden && $("#confirmModal").hidden) closeProductForm();
});

$("#reviewLinkUrl").textContent = reviewLink();

boot();

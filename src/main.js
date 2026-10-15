import { state, $ } from "./state.js";
import {
  renderModules,
  renderFilters,
  renderDrawer,
  updateCartCount,
  openCart,
  closeCart,
  setFilter,
  openPreview,
  closePreview,
  toggleSelectMenu,
} from "./render.js";
import { loadProducts, loadCart, addToCart, addAllToCart, removeFromCart } from "./cart.js";
import { placeOrder, applyDiscount, removeDiscount, loadPaystack } from "./checkout.js";
import { openDownloadModal, closeDownloadModal, submitDownloadRequest } from "./downloads.js";
import { openFreebie, closeFreebie, submitFreebie } from "./freebies.js";
import { initFaqAccordions } from "./faq.js";
import { initReviews } from "./reviews.js";
import { startPresence } from "./presence.js";
import { hasDB, sbRpc } from "./supabase.js";

/* ------------------------------------------------------------------
   Delegated click handling — the grid and drawer are re-rendered often,
   so listeners live on the document rather than on individual elements.
------------------------------------------------------------------ */
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    addToCart(add.dataset.add);
    if (add.closest("#previewModal")) closePreview();
    return;
  }

  const freebie = e.target.closest("[data-freebie]");
  if (freebie) return openFreebie(freebie.dataset.freebie);
  if (e.target.closest("#closeFreebie") || e.target.closest("#freebieScrim")) return closeFreebie();

  if (e.target.closest("#selectToggle")) return toggleSelectMenu();
  const select = e.target.closest("[data-select]");
  if (select) {
    toggleSelectMenu(false);
    return addAllToCart(select.dataset.select);
  }
  // Any other click closes the menu, then carries on as normal.
  if (!$("#selectList").hidden && !e.target.closest("#selectMenu")) toggleSelectMenu(false);

  const remove = e.target.closest("[data-rm]");
  if (remove) return removeFromCart(remove.dataset.rm);

  const preview = e.target.closest("[data-preview]");
  if (preview) return openPreview(preview.dataset.preview);
  if (e.target.closest("#closePreview") || e.target.closest("#previewScrim")) return closePreview();

  if (e.target.closest("#openDownload")) {
    e.preventDefault();
    return openDownloadModal();
  }
  if (e.target.closest("#closeDownload") || e.target.closest("#downloadScrim")) return closeDownloadModal();

  const jump = e.target.closest("[data-jump]");
  if (jump) {
    e.preventDefault();
    return setFilter(jump.dataset.jump);
  }

  const filter = e.target.closest("[data-filter]");
  if (filter) return setFilter(filter.dataset.filter);

  if (e.target.closest("#cartBtn")) return openCart();
  if (e.target.closest("#closeCart") || e.target.closest("#scrim")) return closeCart();

  if (e.target.closest("#keepShopping")) {
    state.checkoutStep = "cart";
    renderDrawer();
    return closeCart();
  }
  if (e.target.closest("#toDetails")) {
    state.checkoutStep = "details";
    renderDrawer();
    loadPaystack().catch(() => {}); // warm it up so the popup opens straight away; placeOrder retries or falls back
    setTimeout(() => $("#buyerEmail")?.focus(), 60);
    return;
  }
  if (e.target.closest("#backToCart")) {
    state.checkoutStep = "cart";
    return renderDrawer();
  }
  if (e.target.closest("#placeOrder")) return placeOrder();
  if (e.target.closest("#applyDiscount")) return applyDiscount();
  if (e.target.closest("#removeDiscount")) return removeDiscount();

  if (e.target.closest("#menuBtn")) {
    const nav = $("#nav");
    const open = nav.classList.toggle("is-open");
    $("#menuBtn").setAttribute("aria-expanded", String(open));
    return;
  }
  if (e.target.closest("#nav a")) return $("#nav").classList.remove("is-open");
});

// Any [data-download-form] — the modal's and the Contact section's are the
// same markup shape, both handled by src/downloads.js.
document.addEventListener("submit", (e) => {
  if (e.target.id === "freebieForm") {
    e.preventDefault();
    return submitFreebie();
  }
  const form = e.target.closest("[data-download-form]");
  if (!form) return;
  e.preventDefault();
  submitDownloadRequest(form);
});

document.addEventListener("keydown", (e) => {
  // No <form> around the details step, so Enter wouldn't do anything here otherwise.
  if (e.key === "Enter" && e.target.id === "discountInput") return applyDiscount();
  if (e.key !== "Escape") return;
  if (!$("#selectList").hidden) {
    toggleSelectMenu(false);
    return $("#selectToggle").focus();
  }
  if (!$("#previewModal").hidden) return closePreview();
  if (!$("#downloadModal").hidden) return closeDownloadModal();
  if (!$("#freebieModal").hidden) return closeFreebie();
  closeCart();
});

/* ------------------------------------------------------------------
   Nav underline follows the section in view
------------------------------------------------------------------ */
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll(".nav a").forEach((a) => {
        a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -50% 0px" }
);
["shop", "about", "reviews", "faqs", "contact"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) observer.observe(el);
});

/* ------------------------------------------------------------------
   Returning from Paystack's payment page. paid=1 only means the buyer came
   back through the flow — not that the payment actually succeeded (Paystack
   sends everyone here, declined or cancelled included). The real answer
   comes from paystack-webhook, which the browser can't see, so this opens
   the download modal and lets it check (and quietly retry) rather than
   promising a purchase that might not have gone through. The email comes
   from localStorage (saved by checkout.js right before the Paystack
   redirect) so this works with no typing — a buyer using a different
   device or browser just uses the footer's "Get your notes" link instead.
------------------------------------------------------------------ */
const returnParams = new URLSearchParams(location.search);
if (returnParams.get("paid") === "1") {
  const reference = returnParams.get("ref") || "";
  let email = "";
  try {
    email = localStorage.getItem("cta_last_email") || "";
    // Back from a payment for the order this cart became — clear the saved
    // cart before loadCart() below reads it. Normally paymentDone() in
    // checkout.js has already done this (popup flow); this covers the
    // full-page fallback, and Paystack redirecting here instead of calling back.
    if (reference && reference === localStorage.getItem("cta_last_ref")) localStorage.removeItem("cta_cart");
  } catch {
    // localStorage unavailable — the download modal still opens, just without a prefilled email
  }
  history.replaceState({}, "", location.pathname + location.hash);
  openDownloadModal({ reference, email, auto: Boolean(reference && email) });
}

/* ------------------------------------------------------------------
   "1 000+ notes sold" under the hero button — from notes_sold() in
   supabase/schema.sql, which returns only the number. Rounded down to a
   round figure so it reads as a milestone and doesn't tick with every
   sale. Stays hidden below SOLD_MIN, since a small count reads worse than
   none, and on any error.
------------------------------------------------------------------ */
const SOLD_MIN = 25;

/** 37 -> 30, 640 -> 600, 1284 -> 1200, 12 840 -> 12 000 */
function roundSold(n) {
  const step = n < 100 ? 10 : n < 1000 ? 50 : n < 10000 ? 100 : 1000;
  return Math.floor(n / step) * step;
}

async function showNotesSold() {
  if (!hasDB) return;
  let sold;
  try {
    sold = Number(await sbRpc("notes_sold"));
  } catch {
    return; // not worth surfacing — the hero just stays as it was
  }
  if (!(sold >= SOLD_MIN)) return;

  const target = roundSold(sold);
  const num = $("#notesSold [data-count]");
  const show = (n) => (num.innerHTML = `${n.toLocaleString("en-ZA")}<i>+</i>`);
  $("#notesSold [data-sr]").textContent = `${target.toLocaleString("en-ZA")}+ notes sold`;
  $("#notesSold").hidden = false;

  // Count up from 0 when it appears, unless the visitor has asked for less motion.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return show(target);
  const start = performance.now();
  const DURATION = 1200;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    const eased = 1 - Math.pow(1 - t, 3);
    show(t < 1 ? Math.round((target * eased) / 10) * 10 : target);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------
   Init
------------------------------------------------------------------ */
$("#yr").textContent = new Date().getFullYear();
loadCart(); // before the first render, so a restored cart shows immediately rather than popping in
updateCartCount();
renderModules();
renderFilters();
renderDrawer();
loadProducts();
initFaqAccordions();
initReviews();
startPresence();
showNotesSold();

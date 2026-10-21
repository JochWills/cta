import { state, $ } from "./state.js";
import {
  renderModules,
  renderFilters,
  renderDrawer,
  updateCartCount,
  openCart,
  closeCart,
  setFilter,
  setCourse,
  hasBridging,
  openPreview,
  closePreview,
  toggleSelectMenu,
  toggleModuleMenu,
} from "./render.js";
import { loadProducts, loadCart, addToCart, addAllToCart, removeFromCart } from "./cart.js";
import { placeOrder, applyDiscount, removeDiscount, loadPaystack } from "./checkout.js";
import { openDownloadModal, closeDownloadModal, submitDownloadRequest } from "./downloads.js";
import { openFreebie, closeFreebie, submitFreebie } from "./freebies.js";
import { initFaqAccordions } from "./faq.js";
import { initReviews } from "./reviews.js";
import { startPresence, track } from "./presence.js";
import { hasDB, sbRpc } from "./supabase.js";
import { initNotePage, renderNotePage } from "./note-page.js";

/* ------------------------------------------------------------------
   Delegated click handling — the grid and drawer are re-rendered often,
   so listeners live on the document rather than on individual elements.
------------------------------------------------------------------ */
/** The mobile menu (a dropdown card below 1024px; on desktop the links are
 * always showing and this never runs). Dims and locks the page while open. */
function setMenu(open) {
  $("#nav").classList.toggle("is-open", open);
  document.documentElement.classList.toggle("menu-open", open);
  $("#menuBtn").setAttribute("aria-expanded", String(open));
  $("#menuBtn").setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#nav").classList.contains("is-open")) setMenu(false);
});
// Closes itself if the screen is widened past the mobile layout while open.
matchMedia("(min-width: 1025px)").addEventListener("change", (e) => e.matches && setMenu(false));

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    addToCart(add.dataset.add);
    if (add.closest("#previewModal")) closePreview();
    return;
  }

  const freebie = e.target.closest("[data-freebie]");
  if (freebie) {
    if (freebie.closest("#previewModal")) closePreview();
    return openFreebie(freebie.dataset.freebie);
  }
  if (e.target.closest("#closeFreebie") || e.target.closest("#freebieScrim")) return closeFreebie();

  if (e.target.closest("#moduleToggle")) return toggleModuleMenu();
  if (e.target.closest("#selectToggle")) return toggleSelectMenu();
  const select = e.target.closest("[data-select]");
  if (select) {
    toggleSelectMenu(false);
    return addAllToCart(select.dataset.select);
  }
  // Any other click closes the menu, then carries on as normal.
  if (!$("#selectList").hidden && !e.target.closest("#selectMenu")) toggleSelectMenu(false);
  if (!$("#moduleList").hidden && !e.target.closest("#moduleList")) toggleModuleMenu(false);

  const remove = e.target.closest("[data-rm]");
  if (remove) return removeFromCart(remove.dataset.rm);

  // Before the preview check — the button sits inside a clickable card.
  const more = e.target.closest("[data-more]");
  if (more) {
    const open = more.closest(".card").classList.toggle("is-open");
    more.textContent = open ? "Show less" : "Read more";
    return;
  }

  // A card's title is a real link to the note's own page (for Google and
  // new-tab clicks); a plain click opens the popup instead.
  const link = e.target.closest(".card-link");
  if (link && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;

  const preview = e.target.closest("[data-preview]");
  if (preview) {
    if (link) e.preventDefault();
    return openPreview(preview.dataset.preview);
  }
  if (e.target.closest("[data-open-cart]")) return openCart();
  if (e.target.closest("#closePreview") || e.target.closest("#previewScrim")) return closePreview();

  if (e.target.closest("#openDownload, [data-open-download]")) {
    setMenu(false);
    e.preventDefault();
    return openDownloadModal();
  }
  if (e.target.closest("#closeDownload") || e.target.closest("#downloadScrim")) return closeDownloadModal();

  const jump = e.target.closest("[data-jump]");
  if (jump) {
    e.preventDefault();
    setMenu(false); // the header's "Free" link is one of these
    return setFilter(jump.dataset.jump);
  }

  const course = e.target.closest("[data-course]");
  if (course) return setCourse(course.dataset.course);

  const filter = e.target.closest("[data-filter]");
  if (filter) {
    toggleModuleMenu(false);
    return setFilter(filter.dataset.filter);
  }

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
    track("checkout");
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

  if (e.target.closest("#menuBtn")) return setMenu(!$("#nav").classList.contains("is-open"));
  if (e.target.closest("#menuBackdrop")) return setMenu(false);
  if (e.target.closest("#nav a")) return setMenu(false);
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
  // Up/down move through the module dropdown's options while it's open.
  if (!$("#moduleList").hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const opts = [...document.querySelectorAll("#moduleList .module-option")];
    const i = opts.indexOf(document.activeElement);
    return opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length]?.focus();
  }
  if (e.key !== "Escape") return;
  if (!$("#moduleList").hidden) {
    toggleModuleMenu(false);
    return $("#moduleToggle").focus();
  }
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
      // Not "Free" — it also points at #shop, and Shop is the one to underline there.
      document.querySelectorAll(".nav a:not([data-jump])").forEach((a) => {
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
  // The thank-you email's link carries the email itself, so it works on any device.
  let email = returnParams.get("email") || "";
  try {
    email = email || localStorage.getItem("cta_last_email") || "";
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
initNotePage(); // a /notes/<slug> page — before the first render, so the hero never shows
loadCart(); // before the first render, so a restored cart shows immediately rather than popping in
updateCartCount();
renderModules();
renderFilters();
renderDrawer();
loadProducts().then(() => {
  renderNotePage();
  // pgdanotes.co.za/#bridging opens the shop on the bridging course — a link to share with bridging students.
  if (location.hash === "#bridging" && hasBridging()) {
    setCourse("bridging");
    $("#shop").scrollIntoView({ block: "start" });
  }
});
initFaqAccordions();
initReviews();
startPresence();
showNotesSold();
